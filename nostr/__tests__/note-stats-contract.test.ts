import { describe, test, expect } from 'vitest';
import { CountInt, NoteStats, Sats } from '@sovranbitcoin/schemas';

import { statsFromMetrics } from '../src/facade/feed';
import { COUNT_MAX, SATS_MAX, toNoteStats } from '../src/facade/noteStatsContract';

/**
 * `NoteStats` declares `CountInt`/`Sats` — non-negative integers — but every
 * tier reached it through a TypeScript cast, and both wire schemas accept a
 * bare `z.number()` (`NaggNoteMetricsSchema`, and Primal's
 * `satszapped`/counts). Nothing rounded in between, so a provider that broke
 * the contract sent a fraction straight into app state.
 *
 * That lands somewhere expensive. `recordZapPaid` persists
 * `expectedSats = baseSats + deltaSats` under `z.number().int()`, and the
 * persist merge is all-or-nothing: one fractional `satsZapped` discards the
 * WHOLE social store — follow set, contact tags, engagement map, both deletion
 * sets — on every launch, for as long as it sits in the blob.
 */
const ID = 'a'.repeat(64);

describe('note stats contract', () => {
  test('holds the shape `NoteStats` promises', () => {
    const out = toNoteStats({
      likes: 12.5,
      reposts: 3.9,
      replies: 0.4,
      zaps: 2.5,
      satsZapped: 21.5,
    });

    // Parsed, not just shaped: this is the contract the rest of the app —
    // including the persisted stores that derive integers from it — is
    // entitled to assume.
    expect(NoteStats.safeParse(out).success).toBe(true);
    expect(out).toEqual({ likes: 12, reposts: 3, replies: 0, zaps: 2, satsZapped: 21 });
  });

  test('floors rather than rounds, so a count is never invented', () => {
    // Rounding 0.6 up would claim a like nobody gave.
    expect(toNoteStats({ likes: 0.6, reposts: 0, replies: 0, zaps: 0, satsZapped: 0.9 })).toEqual({
      likes: 0,
      reposts: 0,
      replies: 0,
      zaps: 0,
      satsZapped: 0,
    });
  });

  test('refuses negatives, non-finite values and out-of-contract magnitudes', () => {
    const out = toNoteStats({
      likes: -5,
      reposts: Number.NaN,
      replies: Number.POSITIVE_INFINITY,
      zaps: 1e12,
      satsZapped: 9e15,
    });
    expect(NoteStats.safeParse(out).success).toBe(true);
    expect(out).toEqual({
      likes: 0,
      reposts: 0,
      replies: 0,
      zaps: 1_000_000_000,
      satsZapped: 2_100_000_000_000_000,
    });
  });

  test('clamps to exactly the boundary each schema accepts', () => {
    // The ceilings are written out here rather than read off the schemas, so
    // this is what keeps them honest if `CountInt`/`Sats` move upstream.
    expect(CountInt.safeParse(COUNT_MAX).success).toBe(true);
    expect(CountInt.safeParse(COUNT_MAX + 1).success).toBe(false);
    expect(Sats.safeParse(SATS_MAX).success).toBe(true);
    expect(Sats.safeParse(SATS_MAX + 1).success).toBe(false);
  });

  test('leaves well-formed metrics exactly as they are', () => {
    const clean = { likes: 12, reposts: 3, replies: 4, zaps: 2, satsZapped: 2100 };
    expect(toNoteStats(clean)).toEqual(clean);
  });

  test('the Primal mapper goes through it', async () => {
    // The tier the app does not own, so the one this actually guards.
    const { demuxPrimalFeed } = await import('../src/facade/primal/demux');
    const { stats } = demuxPrimalFeed([
      {
        kind: 10000100,
        content: JSON.stringify({
          event_id: ID,
          likes: 2.9,
          reposts: 0,
          replies: 0,
          zaps: 1,
          satszapped: 21.5,
        }),
      },
    ] as Parameters<typeof demuxPrimalFeed>[0]);
    expect(stats[ID]).toEqual({ likes: 2, reposts: 0, replies: 0, zaps: 1, satsZapped: 21 });
  });

  test('the nagg mapper goes through it', () => {
    const stats = statsFromMetrics({
      [ID]: { likeCount: 1.5, repostCount: 0, replyCount: 0, satsZapped: 21.5, zapCount: 1 },
    });
    expect(stats[ID]).toEqual({
      likes: 1,
      reposts: 0,
      replies: 0,
      zaps: 1,
      satsZapped: 21,
    });
    expect(NoteStats.safeParse(stats[ID]).success).toBe(true);
  });
});
