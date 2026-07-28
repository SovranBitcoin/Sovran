/**
 * @jest-environment node
 */

import { generateSeededGradient } from '@/shared/lib/avatarGradient';

describe('generateSeededGradient', () => {
  // Characterization pin: these exact outputs define the hues every existing
  // profile banner (and glass-era avatar) renders for a given seed. The
  // internal PRNG draw order must never change — any refactor of the palette
  // derivation has to keep these byte-identical. Values captured from the
  // implementation before `deriveSeededPalette` was extracted.
  const PINNED: Record<string, ReturnType<typeof generateSeededGradient>> = {
    // analogous-harmony branch (harmonyMode <= 0.75)
    a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90: {
      primaryColors: ['hsla(12, 67%, 54%, 1)', 'hsla(357, 70%, 47%, 1)', 'hsla(334, 66%, 36%, 1)'],
      overlayColors: ['rgba(255,255,255,0.238)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.180)'],
      primaryStart: { x: 0, y: 0.1 },
      primaryEnd: { x: 1, y: 0.9 },
      overlayStart: { x: 0.25, y: 0 },
      overlayEnd: { x: 0.75, y: 1 },
    },
    // complementary-harmony branch (harmonyMode > 0.75 — extra PRNG draw)
    deadbeef: {
      primaryColors: ['hsla(247, 58%, 57%, 1)', 'hsla(219, 60%, 50%, 1)', 'hsla(129, 53%, 39%, 1)'],
      overlayColors: ['rgba(255,255,255,0.190)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.264)'],
      primaryStart: { x: 0.25, y: 0 },
      primaryEnd: { x: 0.75, y: 1 },
      overlayStart: { x: 0.15, y: 0 },
      overlayEnd: { x: 0.85, y: 1 },
    },
    'npub-test-seed': {
      primaryColors: ['hsla(196, 60%, 54%, 1)', 'hsla(214, 62%, 47%, 1)', 'hsla(315, 56%, 36%, 1)'],
      overlayColors: ['rgba(255,255,255,0.187)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.172)'],
      primaryStart: { x: 0, y: 0 },
      primaryEnd: { x: 1, y: 1 },
      overlayStart: { x: 0, y: 0 },
      overlayEnd: { x: 1, y: 1 },
    },
    '00ff00ff00ff00ff': {
      primaryColors: ['hsla(325, 71%, 61%, 1)', 'hsla(347, 72%, 54%, 1)', 'hsla(82, 65%, 43%, 1)'],
      overlayColors: ['rgba(255,255,255,0.231)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.248)'],
      primaryStart: { x: 0, y: 0.25 },
      primaryEnd: { x: 1, y: 0.75 },
      overlayStart: { x: 0.15, y: 0 },
      overlayEnd: { x: 0.85, y: 1 },
    },
  };

  it.each(Object.keys(PINNED))('produces the pinned theme for seed %s', (seed) => {
    expect(generateSeededGradient(seed)).toEqual(PINNED[seed]);
  });

  it('is deterministic per seed', () => {
    expect(generateSeededGradient('npub-test-seed')).toEqual(
      generateSeededGradient('npub-test-seed')
    );
  });
});
