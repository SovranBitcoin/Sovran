import { resolveAcrossTiers } from './select';
import type { TierCandidate, TierReadContext, TierResolution } from './types';

/**
 * Advisory second opinion: try the given (already-filtered) tiers in order,
 * first answer wins — same engine and `nostr.tier.*` logging as
 * `resolveAcrossTiers`. Unlike a primary read, exhaustion is a NORMAL empty
 * outcome (`null`), never an error surfaced to UI: the primary answer already
 * rendered, an audit can only add.
 */
export async function auditAcrossTiers<T>(
  candidates: ReadonlyArray<TierCandidate<T>>,
  context: TierReadContext = {},
): Promise<TierResolution<T> | null> {
  if (candidates.length === 0) return null;
  const result = await resolveAcrossTiers(candidates, context);
  return result.match<TierResolution<T> | null>(
    (resolved) => resolved,
    () => null,
  );
}
