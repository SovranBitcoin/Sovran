import { ok, err, type Result } from 'neverthrow';
import type { NostrTier } from '@sovranbitcoin/schemas';
import { nostrLog } from '../log';
import type {
  TierAttemptLog,
  TierCandidate,
  TierOutcome,
  TierReadContext,
  TierResolutionError,
} from './types';

// ---------------------------------------------------------------------------
// Aggregate tier engine — fan out, paint early, keep merging
//
// The sequential engine (`resolveAcrossTiers`) is right for ORDERED reads: a
// feed page or a thread is one ranking, and merging two rankings reshuffles
// rows. For gap-fillable reads — profile metadata, follower/following counts,
// search hits, mint reviews — the best answer is the UNION: nagg is fastest and
// richest, Primal covers what nagg lacks, relays fill the rest. Waiting for the
// slowest source before painting anything is the wrong shape there, and so is
// giving up on the rest once one source answers.
//
// `resolveAllTiers` opens every candidate at once and resolves with the best
// envelope so far as soon as the first-paint gate is met (`minItems` usable
// items, or `capMs` elapsed — but NEVER while nothing has answered: the cap
// defers to the first answer, the same rule the notifications session uses).
// Later answers keep merging through `onUpdate`, ending with one final
// `complete: true` tick. Exhaustion (nobody answered by all-settled) returns
// the same `all_tiers_exhausted` error the sequential engine returns, so
// callers share one failure path.
//
// `merge` must be idempotent and order-independent, and must APPEND rather than
// reorder what an earlier answer painted — a later relay answer may only add
// rows or fill blanks, never move a row the viewer is already looking at.
// ---------------------------------------------------------------------------

export type AggregateGate = {
  /** Paint once this many usable items have accumulated (per `count`). Default 1. */
  minItems?: number;
  /** Paint at this many ms even if `minItems` isn't met — but never while nothing has answered. Default 600. */
  capMs?: number;
  /** Paint only at all-settled; ignore `minItems`/`capMs`. Default false. */
  requireAll?: boolean;
};

export type TierAggregate<T> = {
  value: T;
  /** Best-ranked source that has contributed (nagg > primal > relay); mirrors `TierResolution.tier`. */
  tier: NostrTier;
  /** Every source that has answered so far, in answer order. */
  sources: NostrTier[];
  /** Sources that did not answer (unsupported / failed), so far. */
  attempts: TierAttemptLog[];
  /** At least one source FAILED (not merely unsupported). */
  degraded: boolean;
  /** Every source has settled. */
  complete: boolean;
  /** Sources still in flight when this envelope was produced. */
  pending: NostrTier[];
};

export type AggregateOptions<T> = TierReadContext & {
  gate?: AggregateGate;
  /** Usable-item count of a value (drives `minItems`). */
  count: (value: T) => number;
  /** Idempotent, order-independent merge. Called for every answer, including the first (`acc` undefined). */
  merge: (acc: T | undefined, next: T, tier: NostrTier) => T;
  /**
   * Post-paint updates: called after each later merge, after each later
   * non-answer (so `pending`/`degraded` stay current), and once more at settle
   * with `complete: true`. Never called before the returned promise resolves.
   */
  onUpdate?: (envelope: TierAggregate<T>) => void;
  /**
   * Bookkeeping ceiling per source. A source still pending at this point is
   * recorded as `failed` so `complete` always arrives; the source's own
   * network timeout (via `RequestControls`) still governs the request itself.
   * Default 10_000.
   */
  sourceTimeoutMs?: number;
  /** Timer seam (tests). */
  scheduleAfter?: (ms: number, fire: () => void) => () => void;
};

const TIER_ORDER: readonly NostrTier[] = ['nagg', 'primal', 'relay', 'cache'];
const rankOf = (tier: NostrTier): number => {
  const index = TIER_ORDER.indexOf(tier);
  return index < 0 ? TIER_ORDER.length : index;
};

const DEFAULT_MIN_ITEMS = 1;
const DEFAULT_CAP_MS = 600;
const DEFAULT_SOURCE_TIMEOUT_MS = 10_000;

const defaultScheduleAfter = (ms: number, fire: () => void): (() => void) => {
  const timer = setTimeout(fire, ms);
  return () => clearTimeout(timer);
};

type PaintGate = 'minItems' | 'capMs' | 'allSettled';

export function resolveAllTiers<T>(
  candidates: ReadonlyArray<TierCandidate<T>>,
  options: AggregateOptions<T>,
): Promise<Result<TierAggregate<T>, TierResolutionError>> {
  const ctx = { readId: options.readId ?? null, surface: options.surface ?? null };
  const minItems = options.gate?.minItems ?? DEFAULT_MIN_ITEMS;
  const capMs = options.gate?.capMs ?? DEFAULT_CAP_MS;
  const requireAll = options.gate?.requireAll ?? false;
  const scheduleAfter = options.scheduleAfter ?? defaultScheduleAfter;
  const sourceTimeoutMs = options.sourceTimeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const startedAt = Date.now();

  let acc: T | undefined;
  let items = 0;
  const sources: NostrTier[] = [];
  const attempts: TierAttemptLog[] = [];
  const pending = new Set<NostrTier>(candidates.map((c) => c.tier));
  let painted = false;
  let best: NostrTier | null = null;

  nostrLog.debug('nostr.tier.aggregate.start', {
    ...ctx,
    tiers: candidates.map((c) => c.tier),
    gate: { minItems, capMs, requireAll },
  });

  const envelope = (): TierAggregate<T> => ({
    value: acc as T,
    tier: best ?? 'relay',
    sources: [...sources],
    attempts: [...attempts],
    degraded: attempts.some((a) => a.outcome === 'failed'),
    complete: pending.size === 0,
    pending: [...pending],
  });

  return new Promise((resolve) => {
    let capExpired = false;
    let cancelCap: () => void = () => {};

    const finishPaint = (gate: PaintGate): void => {
      if (painted) return;
      painted = true;
      cancelCap();
      nostrLog.info('nostr.tier.aggregate.paint', {
        ...ctx,
        gate,
        answered: [...sources],
        pending: [...pending],
        count: items,
        elapsedMs: Date.now() - startedAt,
      });
      if (sources.length > 0) {
        resolve(ok(envelope()));
        return;
      }
      resolve(
        err({
          type: 'all_tiers_exhausted',
          message:
            candidates.length === 0
              ? 'no tiers were offered for this read'
              : `all ${candidates.length} tier(s) exhausted: ${attempts
                  .map((a) => `${a.tier}=${a.outcome}`)
                  .join(', ')}`,
          attempts: [...attempts],
        }),
      );
    };

    const settleOne = (tier: NostrTier, outcome: TierOutcome<T>, durationMs: number): void => {
      if (!pending.has(tier)) return; // the per-source timeout already recorded this one
      pending.delete(tier);
      if (outcome.kind === 'answered') {
        const answeredCount = options.count(outcome.value);
        nostrLog.info('nostr.tier.aggregate.source', {
          ...ctx,
          tier,
          outcome: 'answered',
          durationMs,
          count: answeredCount,
        });
        acc = options.merge(acc, outcome.value, tier);
        items = options.count(acc);
        sources.push(tier);
        if (best === null || rankOf(tier) < rankOf(best)) best = tier;
        if (painted) {
          nostrLog.debug('nostr.tier.aggregate.merged', {
            ...ctx,
            tier,
            count: items,
            complete: pending.size === 0,
          });
        }
      } else {
        const level = outcome.kind === 'failed' ? 'warn' : 'debug';
        nostrLog[level]('nostr.tier.aggregate.source', {
          ...ctx,
          tier,
          outcome: outcome.kind,
          durationMs,
          ...(outcome.kind === 'failed' ? { errorType: outcome.error.type } : {}),
        });
        attempts.push(
          outcome.kind === 'failed'
            ? { tier, outcome: 'failed', error: outcome.error }
            : { tier, outcome: 'unsupported' },
        );
      }

      if (pending.size === 0) {
        nostrLog.info('nostr.tier.aggregate.settled', {
          ...ctx,
          sources: [...sources],
          degraded: attempts.some((a) => a.outcome === 'failed'),
          elapsedMs: Date.now() - startedAt,
        });
        if (!painted) {
          finishPaint('allSettled');
          return;
        }
        options.onUpdate?.(envelope()); // final tick, complete = true
        return;
      }

      if (painted) {
        options.onUpdate?.(envelope());
        return;
      }
      if (!requireAll && sources.length > 0 && (items >= minItems || capExpired)) {
        finishPaint(items >= minItems ? 'minItems' : 'capMs');
      }
    };

    if (!requireAll) {
      cancelCap = scheduleAfter(capMs, () => {
        capExpired = true;
        if (!painted && sources.length > 0) finishPaint('capMs');
        // Nothing answered yet: defer to the first answer (never paint empty while sources pend).
      });
    }

    for (const candidate of candidates) {
      const t0 = Date.now();
      const cancelTimeout = scheduleAfter(sourceTimeoutMs, () =>
        settleOne(
          candidate.tier,
          {
            kind: 'failed',
            error: { type: 'network', message: 'aggregate source timeout', cause: 'timeout' },
          },
          Date.now() - t0,
        ),
      );
      candidate.attempt().then(
        (outcome) => {
          cancelTimeout();
          settleOne(candidate.tier, outcome, Date.now() - t0);
        },
        (thrown: unknown) => {
          // Engine boundary: a throwing attempt is a failed attempt, never a rejection.
          cancelTimeout();
          settleOne(
            candidate.tier,
            { kind: 'failed', error: { type: 'network', message: String(thrown), cause: thrown } },
            Date.now() - t0,
          );
        },
      );
    }

    if (candidates.length === 0) finishPaint('allSettled');
  });
}
