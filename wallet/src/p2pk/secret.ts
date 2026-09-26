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

/**
 * 33-byte compressed secp256k1 P2PK key: `02` or `03`, then 32 bytes of x.
 * NUT-11: "Public keys MUST use the compressed Secp256k1 public key format".
 */
export const P2PK_PUBKEY_RE = /^0[23][0-9a-f]{64}$/i;

/**
 * The lowercase x coordinate of a compressed P2PK key — the form NUT-11
 * compares by. `null` when the input is not a compressed key.
 */
export function p2pkXOnly(value: string | undefined | null): string | null {
  if (!value || !P2PK_PUBKEY_RE.test(value)) return null;
  return value.slice(2).toLowerCase();
}

/**
 * Whether two P2PK keys are the same key under NUT-11 — same x coordinate,
 * whatever the `02`/`03` y-parity prefix or case. `false` when either side is
 * missing or malformed, so an unparseable key is never a match.
 *
 * Sovran only ever mints the `02` form (the x-only lift of a Nostr key), so
 * our own output never exercises the difference. Keys arriving from another
 * wallet do: a true SEC1-compressed key can legitimately be `03`, and
 * whole-string equality reads a token that IS locked to us as somebody else's.
 *
 * `app/shared/lib/protocolIds.ts` owns the same invariant on the app side;
 * duplicated rather than imported because `wallet` must not import from `app`.
 */
export function samePubkey(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const left = p2pkXOnly(a);
  return left !== null && left === p2pkXOnly(b);
}

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
      const parsed: unknown = JSON.parse(proof.secret);
      if (!Array.isArray(parsed) || parsed[0] !== "P2PK") continue;
      const data: unknown = parsed[1]?.data;
      if (typeof data === "string" && data) return data;
    } catch {
      // not a structured secret
    }
  }
  return null;
}
