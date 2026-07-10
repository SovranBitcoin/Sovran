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
import { logger } from "./logger";
import type { PaymentRequestInfo, PaymentRequestTransport } from "./types";

const CREQ_PREFIX = /^creq[ab]/i;
const CREQB_PREFIX = /^creqb1/i;
const P2PK_PUBKEY_RE = /^02[0-9a-f]{64}$/i;

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
  const trimmed = value.trim();
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
  const decoded = tryDecode(() => decodePaymentRequest(trimmed));
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

  const info: PaymentRequestInfo = {
    mints: (decoded.mints ?? []).filter(Boolean),
    amount: amountToNumberOrUndefined(decoded.amount),
    unit: decoded.unit ?? "sat",
    transports,
    lockP2pkPubkey,
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
 * A request is lockable to `nostrPubkeyHex` iff its `nut10` P2PK key equals
 * `02` + that 32-byte x-only hex key. Returns the accepted mints when lockable,
 * else null (no request, undecodable, or lock mismatch).
 */
export function lockableMintsFromRequest(
  value: string | undefined,
  nostrPubkeyHex: string | undefined,
): string[] | null {
  if (!value || !nostrPubkeyHex) return null;
  const info = decodePaymentRequestInfo(value);
  if (!info) return null;
  const expected = `02${nostrPubkeyHex}`.toLowerCase();
  if (!info.lockP2pkPubkey || info.lockP2pkPubkey.toLowerCase() !== expected) {
    logger.debug("paymentRequest.lockable.mismatch", {
      mintCount: info.mints.length,
      hasLock: !!info.lockP2pkPubkey,
    });
    return null;
  }
  logger.debug("paymentRequest.lockable.ok", { mintCount: info.mints.length });
  return info.mints;
}
