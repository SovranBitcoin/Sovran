import { ok, err, type Result } from 'neverthrow';
import type {
  TierCandidate,
  TierResolution,
  TierResolutionError,
  TierAttemptLog,
} from './types';

// ---------------------------------------------------------------------------
// Tier-selection / fallback engine
//
// The single resilience primitive behind every facade read. Try each tier in
// order; the first that ANSWERS wins. A tier that reports `unsupported` (can't
// serve this read) or `failed` (tried and errored) is skipped and recorded.
// If every tier is exhausted, return an error carrying the full attempt trail
// so callers can see exactly why the read could not be served.
//
// Tiers are tried SEQUENTIALLY, not in parallel: the whole point is "use the
// best tier that works", so we don't spend a Primal/relay round-trip when nagg
// already answered. The per-tier timeout lives inside each attempt (via the
// existing RequestControls), not here.
// ---------------------------------------------------------------------------

export async function resolveAcrossTiers<T>(
  candidates: ReadonlyArray<TierCandidate<T>>,
): Promise<Result<TierResolution<T>, TierResolutionError>> {
  const attempts: TierAttemptLog[] = [];

  for (const candidate of candidates) {
    const outcome = await candidate.attempt();
    switch (outcome.kind) {
      case 'answered':
        return ok({ tier: candidate.tier, value: outcome.value });
      case 'unsupported':
        attempts.push({ tier: candidate.tier, outcome: 'unsupported' });
        continue;
      case 'failed':
        attempts.push({ tier: candidate.tier, outcome: 'failed', error: outcome.error });
        continue;
    }
  }

  return err({
    type: 'all_tiers_exhausted',
    message:
      candidates.length === 0
        ? 'no tiers were offered for this read'
        : `all ${candidates.length} tier(s) exhausted: ${attempts
            .map((a) => `${a.tier}=${a.outcome}`)
            .join(', ')}`,
    attempts,
  });
}
