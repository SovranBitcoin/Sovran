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
/**
 * NUT-11 lock key: 33-byte compressed secp256k1, so `02` OR `03` — both parities
 * are legal and both encode the same x coordinate. Sovran only ever mints the
 * `02` form (the x-only lift of a Nostr key), but a true SEC1-compressed key
 * from another wallet can legitimately arrive as `03`, and rejecting it here
 * made a request that IS locked to us look like one that is not.
 */
const P2PK_PUBKEY_RE = /^0[23][0-9a-f]{64}$/i;

/**
 * The x coordinate of a compressed P2PK key, lowercased — the form NUT-11
 * compares by. `null` when the input is not a compressed key.
 *
 * Mirrors `nostrPubkeyHexFromCashuP2pk` in `app/shared/lib/protocolIds.ts`,
 * deliberately duplicated: `wallet` must not import from `app`.
 */
function p2pkXOnly(value: string | undefined | null): string | null {
  if (!value || !P2PK_PUBKEY_RE.test(value)) return null;
  return value.slice(2).toLowerCase();
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
    ...(typeof decoded.id === "string" && decoded.id.length > 0
      ? { requestId: decoded.id }
      : {}),
    mints: (decoded.mints ?? []).filter(Boolean),
    ...(decoded.nut10 ? { hasSpendingCondition: true } : {}),
    mintsPreferred:
      typeof decoded.mintsPreferred === "boolean"
        ? decoded.mintsPreferred
        : undefined,
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
