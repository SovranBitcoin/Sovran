/**
 * @jest-environment node
 */

import {
  NEW_PROFILE_MAX_AGE_SEC,
  PROFILE_TIER_LADDER,
  resolveProfileTier,
} from '@/shared/lib/profile/profileTier';
import { generateTierRingTheme } from '@/shared/lib/avatarGradient';

const NOW = 1_800_000_000;

describe('resolveProfileTier', () => {
  it('knows nothing → no tier (never a guessed rung)', () => {
    expect(resolveProfileTier({ nowSec: NOW })).toBeNull();
    expect(resolveProfileTier({ firstEventAt: null, nowSec: NOW })).toBeNull();
  });

  it('climbs the follower ladder rung by rung', () => {
    expect(resolveProfileTier({ followers: 0, nowSec: NOW })).toBe('iron');
    expect(resolveProfileTier({ followers: 49, nowSec: NOW })).toBe('iron');
    expect(resolveProfileTier({ followers: 50, nowSec: NOW })).toBe('bronze');
    expect(resolveProfileTier({ followers: 300, nowSec: NOW })).toBe('silver');
    expect(resolveProfileTier({ followers: 1_500, nowSec: NOW })).toBe('gold');
    expect(resolveProfileTier({ followers: 6_000, nowSec: NOW })).toBe('platinum');
    expect(resolveProfileTier({ followers: 25_000, nowSec: NOW })).toBe('diamond');
  });

  it('a Vertex score can promote, never demote', () => {
    expect(resolveProfileTier({ followers: 600, score: 70, nowSec: NOW })).toBe('gold');
    expect(resolveProfileTier({ followers: 600, score: 85, nowSec: NOW })).toBe('platinum');
    expect(resolveProfileTier({ followers: 30_000, score: 40, nowSec: NOW })).toBe('diamond');
    expect(resolveProfileTier({ score: 93, nowSec: NOW })).toBe('diamond');
    expect(resolveProfileTier({ score: 20, nowSec: NOW })).toBeNull();
  });

  it('a young account is new regardless of counts; the day it ages out it takes its rung', () => {
    const young = NOW - NEW_PROFILE_MAX_AGE_SEC + 60;
    expect(resolveProfileTier({ followers: 2_000, firstEventAt: young, nowSec: NOW })).toBe('new');
    const aged = NOW - NEW_PROFILE_MAX_AGE_SEC;
    expect(resolveProfileTier({ followers: 2_000, firstEventAt: aged, nowSec: NOW })).toBe('gold');
  });

  it('ladder order is lowest → highest', () => {
    expect(PROFILE_TIER_LADDER).toEqual([
      'iron',
      'bronze',
      'silver',
      'gold',
      'platinum',
      'diamond',
    ]);
  });
});

describe('generateTierRingTheme', () => {
  it('is deterministic per (tier, seed) and varies across seeds within a tier', () => {
    const a = generateTierRingTheme('gold', 'seed-a');
    expect(generateTierRingTheme('gold', 'seed-a')).toEqual(a);
    const b = generateTierRingTheme('gold', 'seed-b');
    expect(b).not.toEqual(a);
    // A seamless sweep: it ends where it starts.
    expect(a.sweep.length).toBeGreaterThanOrEqual(5);
    expect(a.sweep[0]).toBe(a.sweep[a.sweep.length - 1]);
    expect(a.sweep.every((c) => c.startsWith('hsla('))).toBe(true);
  });

  it('keeps every tier on its identity hue (the seam stop is the base hue)', () => {
    const hueOf = (c: string) => Number(/hsla\((\d+),/.exec(c)?.[1]);
    expect(hueOf(generateTierRingTheme('gold', 'x').sweep[0]!)).toBe(44);
    expect(hueOf(generateTierRingTheme('new', 'x').sweep[0]!)).toBe(214);
    expect(hueOf(generateTierRingTheme('bronze', 'x').sweep[0]!)).toBe(24);
    expect(hueOf(generateTierRingTheme('diamond', 'x').sweep[0]!)).toBe(196);
  });
});
