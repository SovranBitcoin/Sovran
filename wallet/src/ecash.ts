// ---------------------------------------------------------------------------
// Ecash token decoding
//
// The single canonical place colada decodes a cashu bearer token's metadata.
// `defaultDetectors.isValidEcashToken` delegates here, and `describeDestination`
// reads `decodeEcashTokenMetadata` to surface the redeem amount. Wallet apps
// import these instead of reaching for `@cashu/cashu-ts` directly.
// ---------------------------------------------------------------------------

import { getEncodedToken, getTokenMetadata } from "@cashu/cashu-ts";

import { amountToNumberOrUndefined } from "./amount";
import { isEvenHex } from "./hex";
import { base64UrlEncode } from "./payment-request-canonical";
import { logger } from "./logger";
import { extractP2PKPubkey } from "./p2pk";

interface EcashTokenMetadata {
  /** Total token amount in `unit`'s base unit (sats for `'sat'`). */
  amount: number;
  mint: string;
  unit: string;
  memo?: string;
  /** First P2PK lock pubkey found across the proofs, else null. */
  p2pkPubkey: string | null;
}

/**
 * Cashu proofs are bearer instruments identified by their secret. Counting the
 * same secret twice inflates the preview amount even though the mint can only
 * redeem it once.
 */
export function hasDuplicateProofSecrets(
  proofs: readonly { secret: string }[],
): boolean {
  const seen = new Set<string>();
  for (const proof of proofs) {
    if (seen.has(proof.secret)) return true;
    seen.add(proof.secret);
  }
  return false;
}

const tryDecode = <T>(fn: () => T): T | null => {
  try {
    return fn();
  } catch {
    return null;
  }
};

/**
 * Decode a cashu token's metadata (amount, mint, unit, memo, P2PK lock). Pure
 * and throw-safe — returns null for any non-token / undecodable input.
 */
export function decodeEcashTokenMetadata(
  token: string,
): EcashTokenMetadata | null {
  const decoded = tryDecode(() => getTokenMetadata(token));
  if (!decoded) {
    logger.debug("ecash.decode.failed", { inputLength: token.length });
    return null;
  }
  if (hasDuplicateProofSecrets(decoded.incompleteProofs)) {
    logger.debug("ecash.decode.duplicateProofSecret", {
      inputLength: token.length,
      proofCount: decoded.incompleteProofs.length,
    });
    return null;
  }
  const amount = amountToNumberOrUndefined(decoded.amount);
  if (amount === undefined) {
    logger.debug("ecash.decode.unreadableAmount", {
      inputLength: token.length,
    });
    return null;
  }
  const metadata: EcashTokenMetadata = {
    amount,
    mint: decoded.mint,
    unit: decoded.unit ?? "sat",
    ...(decoded.memo ? { memo: decoded.memo } : {}),
    p2pkPubkey: extractP2PKPubkey(decoded.incompleteProofs),
  };
  logger.debug("ecash.decode.ok", {
    amount: metadata.amount,
    unit: metadata.unit,
    hasMemo: !!metadata.memo,
    hasP2pk: !!metadata.p2pkPubkey,
  });
  return metadata;
}

/**
 * True when `token` decodes as a cashu token whose mint is an http(s) address
 * and whose every proof carries a secret and a signature. Stricter than
 * `isValidEcashToken`, for callers that would otherwise alter their input to
 * make it read as a token.
 */
export function isWellFormedEcashToken(token: string): boolean {
  if (decodeEcashTokenMetadata(token) === null) return false;
  const decoded = tryDecode(() => getTokenMetadata(token));
  if (!decoded || decoded.incompleteProofs.length === 0) return false;
  const mint = tryDecode(() => new URL(decoded.mint));
  if (!mint || (mint.protocol !== "https:" && mint.protocol !== "http:")) {
    return false;
  }
  return decoded.incompleteProofs.every(
    (proof) =>
      typeof proof.secret === "string" &&
      proof.secret.length > 0 &&
      typeof proof.C === "string" &&
      proof.C.length > 0,
  );
}

/** True when `token` decodes as a valid cashu token. */
export function isValidEcashToken(token: string): boolean {
  return decodeEcashTokenMetadata(token) !== null;
}

const RAW_TOKEN_V4 = [0x63, 0x72, 0x61, 0x77, 0x42]; // "crawB"

/**
 * A NUT-00 binary token as the same token in text form. The two carry the
 * same CBOR: `utf8("craw") || utf8("B") || cbor` against
 * `"cashuB" || base64url(cbor)`. cashu.me and cashu-wallet write the binary
 * form to NFC tags; reading those bytes as UTF-8 destroys them. Only the
 * framing changes here: the parser still decides whether the result is a
 * token. Null for anything that is not `crawB`.
 */
export function ecashTokenTextFromBinary(
  bytes: ArrayLike<number>,
): string | null {
  if (bytes.length <= RAW_TOKEN_V4.length) return null;
  if (RAW_TOKEN_V4.some((byte, index) => bytes[index] !== byte)) return null;
  return `cashuB${base64UrlEncode(
    Uint8Array.from(Array.from(bytes).slice(RAW_TOKEN_V4.length)),
  )}`;
}

type EncodableToken = Parameters<typeof getEncodedToken>[0];

export type TokenEncodeResult =
  | { ok: true; token: string }
  /** A proof field a hex decoder would throw on; `field` names it. */
  | { ok: false; reason: "malformed-proof"; field: string }
  /** cashu-ts refused the token for its own reason. */
  | { ok: false; reason: "encode-failed"; error: unknown };

/**
 * The first proof field that cashu-ts's V4 encoder would hex-decode and throw
 * on, or null. Keyset ids, `C`, DLEQ `e`/`s`/`r` and the P2BK `p2pk_e` must be
 * even-length hex. This checks only what the decoder needs, so a token that
 * encodes today still encodes.
 */
function malformedProofField(token: unknown): string | null {
  const proofs = (token as { proofs?: unknown } | null)?.proofs;
  if (typeof token !== "object" || !Array.isArray(proofs)) return "proofs";
  for (const [index, raw] of proofs.entries()) {
    const at = `proofs[${index}]`;
    if (typeof raw !== "object" || raw === null) return at;
    const proof = raw as Record<string, unknown>;
    if (!isEvenHex(proof.id)) return `${at}.id`;
    if (!isEvenHex(proof.C)) return `${at}.C`;
    if (proof.p2pk_e != null && !isEvenHex(proof.p2pk_e)) return `${at}.p2pk_e`;
    if (proof.dleq != null) {
      if (typeof proof.dleq !== "object") return `${at}.dleq`;
      const dleq = proof.dleq as Record<string, unknown>;
      if (!isEvenHex(dleq.e)) return `${at}.dleq.e`;
      if (!isEvenHex(dleq.s)) return `${at}.dleq.s`;
      if (dleq.r != null && !isEvenHex(dleq.r)) return `${at}.dleq.r`;
    }
  }
  return null;
}

/**
 * Encode a structured token for export (copy, NFC, share) without throwing.
 * Malformed proofs are refused before any hex decoder sees them, so callers
 * can stop before touching a clipboard, radio or the proofs themselves.
 */
export function encodeTokenChecked(token: unknown): TokenEncodeResult {
  const field = malformedProofField(token);
  if (field) {
    logger.warn("ecash.encodeTokenChecked.malformed", { field });
    return { ok: false, reason: "malformed-proof", field };
  }
  try {
    return { ok: true, token: getEncodedToken(token as EncodableToken) };
  } catch (error) {
    return { ok: false, reason: "encode-failed", error };
  }
}
