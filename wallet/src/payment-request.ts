// ---------------------------------------------------------------------------
// NUT-18 payment request (`creq…`) decoding
//
// The single canonical place colada decodes a payment request. `defaultDetectors`
// delegates here, and wallet apps import these instead of `@cashu/cashu-ts`
// directly. A request can carry accepted mints, a fixed amount, transports, and
// a `nut10` P2PK lock — all surfaced on `PaymentRequestInfo`.
// ---------------------------------------------------------------------------

import { decodePaymentRequest } from "@cashu/cashu-ts";

import { amountToNumberOrUndefined } from "./amount";
import { P2PK_PUBKEY_RE, p2pkXOnly } from "./p2pk";
import { logger } from "./logger";
import { canonicalizePaymentRequest } from "./payment-request-canonical";
import { splitSupportedMethods } from "./payment-request-methods";
import type { PaymentRequestInfo, PaymentRequestTransport } from "./types";

const CREQ_PREFIX = /^creq[ab]/i;
const CREQB_PREFIX = /^creqb1/i;


/**
 * Coco's mint-url canonical form (default port, trailing slash and host case
 * dropped). Wallet mints are stored this way; requests from other wallets
 * often carry `https://mint.x/`, which must still match `https://mint.x`.
 */
export function canonicalMintUrl(mintUrl: string): string {
  try {
    const url = new URL(mintUrl.trim());
    const port =
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")
        ? ""
        : url.port;
    const host = port ? `${url.hostname}:${port}` : url.hostname;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol}//${host}${path}`;
  } catch {
    return mintUrl.trim();
  }
}

const tryDecode = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/**
 * Decode a payment request into its structured info (mints, amount, unit,
 * transports, P2PK lock). Pure and throw-safe — returns null for any non-creq
 * or undecodable input.
 */
export function decodePaymentRequestInfo(
  value: string,
): PaymentRequestInfo | null {
  const trimmed = canonicalizePaymentRequest(value);
  if (!CREQ_PREFIX.test(trimmed)) return null;
  // NUT-26 is bech32m: an all-upper or all-lower string is valid, but mixed
  // case must be rejected. cashu-ts 4.5.1 lowercases before its bech32m
  // decoder, so enforce the wire invariant at Sovran's untrusted-input seam.
  if (
    CREQB_PREFIX.test(trimmed) &&
    trimmed !== trimmed.toLowerCase() &&
    trimmed !== trimmed.toUpperCase()
  ) {
    logger.warn("paymentRequest.decode.failed", {
      inputLength: trimmed.length,
      reason: "mixed_case_creqb",
    });
    return null;
  }
  // NUT-18 `sm` is read here, not by the SDK (see payment-request-methods).
  const split = splitSupportedMethods(trimmed);
  const decoded = tryDecode(() =>
    decodePaymentRequest(split?.request ?? trimmed),
  );
  if (!decoded) {
    logger.warn("paymentRequest.decode.failed", {
      inputLength: trimmed.length,
    });
    return null;
  }

  const transports: PaymentRequestTransport[] | undefined =
    decoded.transport?.map((t) => ({ type: t.type, target: t.target ?? "" }));

  const nut10 = decoded.nut10;
  const lockP2pkPubkey =
    nut10 &&
    nut10.kind?.toUpperCase() === "P2PK" &&
    typeof nut10.data === "string" &&
    P2PK_PUBKEY_RE.test(nut10.data)
      ? nut10.data
      : null;

  const requestedMints = (decoded.mints ?? []).filter(Boolean);
  const info: PaymentRequestInfo = {
    ...(typeof decoded.id === "string" && decoded.id.length > 0
      ? { requestId: decoded.id }
      : {}),
    mints: [...new Set(requestedMints.map(canonicalMintUrl))],
    requestedMints,
    ...(decoded.nut10 ? { hasSpendingCondition: true } : {}),
    mintsPreferred:
      typeof decoded.mintsPreferred === "boolean"
        ? decoded.mintsPreferred
        : undefined,
    amount: amountToNumberOrUndefined(decoded.amount),
    unit: decoded.unit ?? "sat",
    transports,
    lockP2pkPubkey,
    ...(split?.methods.length ? { supportedMethods: split.methods } : {}),
  };
  logger.debug("paymentRequest.decode.ok", {
    inputLength: trimmed.length,
    mintCount: info.mints.length,
    hasAmount: info.amount != null,
    unit: info.unit,
    transportTypes: transports?.map((t) => t.type) ?? [],
    hasLock: !!lockP2pkPubkey,
  });
  return info;
}

/**
 * The request as the SDK (cashu-ts, and Coco through it) can decode it. Only
 * a request with NUT-18 supported methods differs from its input: those are
 * removed, having been read into `PaymentRequestInfo.supportedMethods`. A
 * caller that hands this on must have checked `supportedMethodsRefusal`.
 */
export function sdkPaymentRequest(value: string): string {
  return (
    splitSupportedMethods(canonicalizePaymentRequest(value))?.request ?? value
  );
}

/**
 * Why `mintUrl` may not pay a request under its NUT-18 supported methods, or
 * null when it may. NUT-18: the ecash MUST come from a mint that melts the
 * request unit by a listed method (`meltMethods` are the ones this mint
 * offers for that unit). A mint outside the request's list also owes the
 * lowest `mf` among the listed methods it supports; this wallet cannot add
 * that to a payment yet, so such a mint is refused rather than underpaying.
 */
export function supportedMethodsRefusal(
  info: Pick<PaymentRequestInfo, "supportedMethods" | "mints">,
  mintUrl: string,
  meltMethods: readonly string[],
): string | null {
  const methods = info.supportedMethods;
  if (!methods?.length) return null;
  const usable = methods.filter(({ method }) => meltMethods.includes(method));
  if (usable.length === 0) {
    const names = methods.map(({ method }) => method).join(" or ");
    return `This request only accepts ecash from a mint that can pay out by ${names}. Choose another mint.`;
  }
  if (info.mints.includes(canonicalMintUrl(mintUrl))) return null;
  if (Math.min(...usable.map(({ fee }) => fee)) > 0) {
    return "This request charges an extra fee for ecash from this mint, which this wallet cannot add yet. Pay from a mint the request lists.";
  }
  return null;
}

/**
 * A request is lockable to `nostrPubkeyHex` iff its `nut10` P2PK key shares
 * that 32-byte x coordinate, whatever its `02`/`03` parity prefix. Returns the
 * accepted mints when lockable, else null (no request, undecodable, or lock
 * mismatch).
 */
export function lockableMintsFromRequest(
  value: string | undefined,
  nostrPubkeyHex: string | undefined,
): string[] | null {
  if (!value || !nostrPubkeyHex) return null;
  const info = decodePaymentRequestInfo(value);
  if (!info) return null;
  // Compare x coordinates, not whole keys: NUT-11 treats `02<x>` and `03<x>`
  // as the same key, and only the x coordinate is carried by NIP-01.
  const expected = nostrPubkeyHex.toLowerCase();
  const actual = p2pkXOnly(info.lockP2pkPubkey);
  if (!actual || actual !== expected) {
    logger.debug("paymentRequest.lockable.mismatch", {
      mintCount: info.mints.length,
      hasLock: !!info.lockP2pkPubkey,
    });
    return null;
  }
  logger.debug("paymentRequest.lockable.ok", { mintCount: info.mints.length });
  return info.mints;
}
