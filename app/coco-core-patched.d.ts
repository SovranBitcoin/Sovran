/**
 * Type surface for `app/patches/@cashu+coco-core+2.0.0.patch`.
 *
 * The patch is JavaScript-only on purpose. coco ships its declarations as a
 * bundled, alias-mangled chunk (`dist/index-CvKNFBXJ.d.ts`, ~149 KB) whose
 * identifiers are regenerated on every release, so editing it would mean
 * re-diffing a large machine-written file each time coco is bumped for a
 * change that is really just "these six functions are now exported".
 *
 * Declaring the patch's added surface here instead keeps the patch small and
 * stable, and puts the contract somewhere lint and type-check can see it: if
 * coco renames one of these, the app fails to compile at the call site rather
 * than at runtime inside a mint operation.
 *
 * Everything below is exported by the patched `dist/index.js`. The signatures
 * are the loosest ones the callers need, deliberately — the real coco types
 * are expressed against `MintMethod = 'bolt11' | 'bolt12' | 'onchain'` and
 * cannot describe a custom NUT-04 method at all. `genericMintMethod.ts`
 * restates the structural contracts it depends on and keeps the casts in one
 * place.
 */

// The bare import makes this file a MODULE, so the block below augments
// coco's declarations instead of replacing them. Without it TypeScript reads
// `declare module` as an ambient module declaration that shadows the real
// package, and every genuine coco export (`Manager`, `Amount`, …) vanishes.
import '@cashu/coco-core';

declare module '@cashu/coco-core' {
  /**
   * coco's canonical read of how much of a mint quote is paid but not yet
   * issued. `quote` is a canonical quote record; the return `status` is
   * 'claimable' | 'complete' | 'invalid' | 'waiting'.
   */
  export function assessMintQuoteClaimability(
    quote: unknown,
    facts?: {
      requestedAmount?: unknown;
      finalizedAmount?: unknown;
      reservedAmount?: unknown;
    }
  ): { status: string; remoteAvailable?: unknown };

  /** Round-trip for the blinded outputs persisted on a mint operation. */
  export function serializeOutputData(data: { keep: unknown[]; send: unknown[] }): unknown;
  export function deserializeOutputData(data: unknown): { keep: unknown[]; send: unknown[] };

  /** Tags freshly minted cashu-ts proofs for coco's proof repository. */
  export function mapProofToCoreProof(
    mintUrl: string,
    state: 'ready' | 'inflight' | 'spent',
    proofs: unknown[],
    meta: { unit: string; createdByOperationId: string }
  ): unknown[];

  /**
   * Maps a reusable (BOLT12-shaped) quote response to a canonical quote
   * record. Method-agnostic apart from stamping `method: 'bolt12'`, which
   * `genericMintMethod.ts` overwrites with the mint-advertised method.
   */
  export function mintQuoteObservationFromBolt12Response(
    mintUrl: string,
    quote: unknown,
    options?: { now?: number }
  ): unknown;

  /**
   * Whether a polled reusable quote is still attributable to a pending mint
   * operation (quote id, request, unit and NUT-20 pubkey must all match).
   */
  export function getReusableMintQuoteValidationError(
    quote: unknown,
    operation: unknown
  ): Error | null;
}
