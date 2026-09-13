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
  const hueOf = (c: string) => Number(/hsla\((\d+),/.exec(c)?.[1]);
  const lightOf = (c: string) => Number(/hsla\(\d+, \d+%, (\d+)%/.exec(c)?.[1]);

  it('is deterministic per (tier, seed) and varies across seeds within a tier', () => {
    const a = generateTierRingTheme('gold', 'seed-a');
    expect(generateTierRingTheme('gold', 'seed-a')).toEqual(a);
    expect(generateTierRingTheme('gold', 'seed-b')).not.toEqual(a);
    expect(a.blobs.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps every tier on its identity hue (the band is the base hue)', () => {
    const gold = generateTierRingTheme('gold', 'x');
    expect(hueOf(gold.inkLight)).toBe(44);
    expect(hueOf(gold.inkDark)).toBe(44);
    expect(lightOf(gold.inkLight)).toBeGreaterThan(lightOf(gold.base));
    expect(lightOf(gold.inkDark)).toBeLessThan(lightOf(gold.base));
    expect(hueOf(generateTierRingTheme('gold', 'x').base)).toBe(44);
    expect(hueOf(generateTierRingTheme('new', 'x').base)).toBe(214);
    expect(hueOf(generateTierRingTheme('bronze', 'x').base)).toBe(24);
    expect(hueOf(generateTierRingTheme('diamond', 'x').base)).toBe(204);
  });

  it('every blob motion term is a whole number of cycles, so the loop is seamless', () => {
    for (const tier of ['new', 'iron', 'gold', 'platinum', 'diamond'] as const) {
      for (const blob of generateTierRingTheme(tier, 'seed').blobs) {
        expect(Number.isInteger(blob.turns)).toBe(true);
        expect(blob.turns).not.toBe(0);
        expect(Number.isInteger(blob.wobbleCycles)).toBe(true);
        expect(Number.isInteger(blob.breathCycles)).toBe(true);
        expect(blob.radius).toBeGreaterThan(0);
      }
    }
  });

  it('staggers blob start angles evenly so they never open bunched', () => {
    const { blobs } = generateTierRingTheme('gold', 'seed-a');
    const angles = blobs.map((b) => b.angle).sort((x, y) => x - y);
    const slot = (Math.PI * 2) / blobs.length;
    for (let i = 1; i < angles.length; i += 1) {
      expect(angles[i]! - angles[i - 1]!).toBeGreaterThan(slot * 0.5);
    }
  });

  it('diamond is near-white ice with prismatic blobs', () => {
    const a = generateTierRingTheme('diamond', 'seed-a');
    expect(lightOf(a.base)).toBeGreaterThanOrEqual(82); // 86 ± the per-seed jitter
    const hues = a.blobs.map((b) => hueOf(b.color));
    expect(hues).toEqual(expect.arrayContaining([325, 262, 190, 42]));
  });
});
