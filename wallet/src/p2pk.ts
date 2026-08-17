// ---------------------------------------------------------------------------
// P2PK secret inspection
// ---------------------------------------------------------------------------
//
// A P2PK-locked proof carries a structured NUT-11 secret: the JSON array
// `["P2PK", { data: <pubkey>, ... }]`. Both questions the wallet asks of that
// secret — "is anything here locked?" and "locked to whom?" — live here so the
// parse rule cannot drift between the annotation selectors, the ecash send
// path, the screen-actions runtime, and the default operations. A divergence
// between two copies of this check is a funds-visibility bug, not a style nit.

/** True when ANY proof in the set carries a structured P2PK secret. */
export function proofsHaveP2PK(proofs: readonly { secret: string }[]): boolean {
  return proofs.some((proof) => {
    try {
      const parsed = JSON.parse(proof.secret);
      return Array.isArray(parsed) && parsed[0] === "P2PK";
    } catch {
      return false;
    }
  });
}

/**
 * The pubkey the first P2PK-locked proof is locked to, or null when no proof in
 * the set carries a structured `["P2PK", { data }]` secret.
 */
export function extractP2PKPubkey(
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
