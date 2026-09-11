import type { NoteStats } from '@sovranbitcoin/schemas';

/**
 * Normalise a tier's per-note metrics onto the shared `NoteStats` contract.
 *
 * `NoteStats` has always declared these as `CountInt`/`Sats` — non-negative
 * integers — but the mapping from each tier was a TypeScript cast, so nothing
 * enforced it at runtime. Both wire schemas accept a bare `z.number()`
 * (`NaggNoteMetricsSchema`, and Primal's `satszapped`/counts), and neither
 * mapper rounded, so a provider that broke the contract sent a fraction
 * straight through into app state.
 *
 * Where that lands is the reason this exists. `recordZapPaid` persists
 * `expectedSats = baseSats + deltaSats` under `z.number().int()`, and the
 * persist merge is all-or-nothing: one fractional `satsZapped` would discard
 * the WHOLE social store — follow set, contact tags, engagement map, both
 * deletion sets — on every launch, for as long as it sat in the blob. The same
 * shape holds for `expectedCount` and the like/repost counts.
 *
 * Nagg cannot produce one (it divides msats with integer division into a
 * `UInt64` column), so this is about the tiers the app does not own. Clamping
 * here, at the one place every tier converges on the contract, keeps the
 * promise `NoteStats` makes rather than widening every store that trusted it.
 */
export function toNoteStats(raw: {
  likes: number;
  reposts: number;
  replies: number;
  zaps: number;
  satsZapped: number;
}): NoteStats {
  return {
    likes: count(raw.likes),
    reposts: count(raw.reposts),
    replies: count(raw.replies),
    zaps: count(raw.zaps),
    satsZapped: sats(raw.satsZapped),
  };
}

/** Floor to a non-negative integer inside the contract's ceiling. */
function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), max);
}

/**
 * The ceilings `CountInt`/`Sats` declare. Written out rather than read off the
 * schemas: Zod 4 has no portable accessor for a check's bound, and reaching
 * for one throws under Jest even where it happens to work under Vitest. The
 * test asserts each is exactly the boundary its schema accepts, so a change
 * upstream fails here instead of silently clamping to the wrong number.
 */
export const COUNT_MAX = 1_000_000_000;
export const SATS_MAX = 2_100_000_000_000_000;

const count = (value: number): number => clamp(value, COUNT_MAX);
const sats = (value: number): number => clamp(value, SATS_MAX);
