import type { NaggError } from '../errors';
import type { NostrTier } from '@sovranbitcoin/schemas';

// ---------------------------------------------------------------------------
// Tier strategy contract
//
// The facade answers every Nostr read by trying tiers in order — nagg → Primal
// → raw relays — and taking the first that can serve the read. Each tier is a
// DEEP module hidden behind this thin contract; callers never see it.
//
// A tier attempt resolves to exactly one of three outcomes, NEVER throws or
// rejects at the engine boundary (failures are folded into `TierOutcome`):
//   - answered:    this tier served the read; its value wins, stop here.
//   - unsupported: this tier structurally cannot serve this read (e.g. Primal
//                  has no my-likes / my-reposts list verb) — fall through with
//                  no error.
//   - failed:      this tier tried and errored (network/http/schema) — fall
//                  through, but remember the error for diagnostics.
// ---------------------------------------------------------------------------

export type TierOutcome<T> =
  | { kind: 'answered'; value: T }
  | { kind: 'unsupported' }
  | { kind: 'failed'; error: NaggError };

/** A single tier's attempt at one read. Must not throw — fold errors into the outcome. */
export type TierAttempt<T> = () => Promise<TierOutcome<T>>;

/** One ordered tier slot the engine will try. */
export type TierCandidate<T> = {
  tier: NostrTier;
  attempt: TierAttempt<T>;
};

/** The winning tier and its value. */
export type TierResolution<T> = {
  tier: NostrTier;
  value: T;
};

/** Per-tier record of why a tier did not answer — surfaced when all are exhausted. */
export type TierAttemptLog = {
  tier: NostrTier;
  outcome: 'unsupported' | 'failed';
  error?: NaggError;
};

/**
 * Log-only correlation for one read. Optional everywhere so existing callers
 * and tests need no change; the facade fills it from `RequestControls.readId`.
 */
export type TierReadContext = {
  readId?: string;
  surface?: string;
};

/**
 * Where a resolved value came from, for degraded/partial UI and diagnostics.
 * Attached (optionally) to aggregate-surface results; the sequential engine's
 * results keep carrying only `tier`.
 */
export type ReadProvenance = {
  readId: string;
  sources: NostrTier[];
  attempts: TierAttemptLog[];
  degraded: boolean;
  complete: boolean;
};

/** Raised only when no tier could serve the read. Carries the full attempt trail. */
export type TierResolutionError = {
  type: 'all_tiers_exhausted';
  message: string;
  attempts: TierAttemptLog[];
};

// Convenience constructors — keep call sites in the tier adapters terse.
export function answered<T>(value: T): TierOutcome<T> {
  return { kind: 'answered', value };
}

export function unsupported<T = never>(): TierOutcome<T> {
  return { kind: 'unsupported' };
}

export function failed<T = never>(error: NaggError): TierOutcome<T> {
  return { kind: 'failed', error };
}
