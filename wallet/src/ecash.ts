// ---------------------------------------------------------------------------
// Ecash token decoding
//
// The single canonical place colada decodes a cashu bearer token's metadata.
// `defaultDetectors.isValidEcashToken` delegates here, and `describeDestination`
// reads `decodeEcashTokenMetadata` to surface the redeem amount. Wallet apps
// import these instead of reaching for `@cashu/cashu-ts` directly.
// ---------------------------------------------------------------------------

import { getTokenMetadata } from "@cashu/cashu-ts";

import { amountToNumber } from "./amount";
import { logger } from "./logger";

export interface EcashTokenMetadata {
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
 * Extract the first P2PK lock pubkey from a token's proofs, if any proof uses
 * a structured `["P2PK", { data }]` secret. Returns the `data` field, else null.
 */
function extractP2PKPubkey(
  proofs: readonly { secret: string }[],
): string | null {
  for (const proof of proofs) {
    try {
      const parsed = JSON.parse(proof.secret);
      if (Array.isArray(parsed) && parsed[0] === "P2PK" && parsed[1]?.data) {
        return parsed[1].data as string;
      }
    } catch {
      // not a structured secret
    }
  }
  return null;
}

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
  const metadata: EcashTokenMetadata = {
    amount: amountToNumber(decoded.amount),
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

/** True when `token` decodes as a valid cashu token. */
export function isValidEcashToken(token: string): boolean {
  return decodeEcashTokenMetadata(token) !== null;
}
