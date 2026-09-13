import type { ProfileTier } from '@/shared/lib/profile/profileTier';

type GradientPoint = { x: number; y: number };

type SeededGradientTheme = {
  primaryColors: readonly [string, string, string];
  overlayColors: readonly [string, string, string];
  primaryStart: GradientPoint;
  primaryEnd: GradientPoint;
  overlayStart: GradientPoint;
  overlayEnd: GradientPoint;
};

function createSeededRandom(seedInput: string): () => number {
  let seed = 0x811c9dc5;
  for (let index = 0; index < seedInput.length; index += 1) {
    seed ^= seedInput.charCodeAt(index);
    seed = Math.imul(seed, 16777619);
  }

  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hsl(h: number, s: number, l: number, a = 1): string {
  const hue = Math.round((h % 360) + 360) % 360;
  const sat = clamp(Math.round(s), 0, 100);
  const light = clamp(Math.round(l), 0, 100);
  return `hsla(${hue}, ${sat}%, ${light}%, ${a})`;
}

const AXES: readonly (readonly [GradientPoint, GradientPoint])[] = [
  [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ],
  [
    { x: 0.15, y: 0 },
    { x: 0.85, y: 1 },
  ],
  [
    { x: 0, y: 0.25 },
    { x: 1, y: 0.75 },
  ],
  [
    { x: 0.25, y: 0 },
    { x: 0.75, y: 1 },
  ],
  [
    { x: 0, y: 0.1 },
    { x: 1, y: 0.9 },
  ],
];

type SeededPalette = {
  baseHue: number;
  hueA: number;
  hueB: number;
  saturationBase: number;
  lightBase: number;
  satC1: number;
  satC3: number;
  glossAlpha: number;
  shadowAlpha: number;
  primaryAxis: readonly [GradientPoint, GradientPoint];
  overlayAxis: readonly [GradientPoint, GradientPoint];
};

// Single source of the seeded palette. The PRNG draw ORDER below is a durable
// contract: it defines the hues every already-shipped profile banner shows for
// a given pubkey. Do not add, remove, reorder, or make conditional any
// `random()` call — `avatarGradient.test.ts` pins the outputs.
function deriveSeededPalette(seedInput: string): SeededPalette {
  const random = createSeededRandom(seedInput);

  const baseHue = random() * 360;
  const harmonyMode = random();
  const spreadA = 10 + random() * 26;
  const spreadB = 18 + random() * 34;
  const direction = random() > 0.5 ? 1 : -1;

  const hueA = baseHue + spreadA * direction;
  const hueB =
    harmonyMode > 0.75
      ? baseHue + (110 + random() * 24) * direction
      : baseHue + spreadB * direction;

  const saturationBase = 58 + random() * 16;
  const lightBase = 44 + random() * 9;

  const satC1 = saturationBase - 6 + random() * 6;
  const satC3 = saturationBase - 8 + random() * 6;

  const glossAlpha = 0.14 + random() * 0.12;
  const shadowAlpha = 0.16 + random() * 0.12;

  const primaryAxis = AXES[Math.floor(random() * AXES.length)];
  const overlayAxis = AXES[Math.floor(random() * AXES.length)];

  return {
    baseHue,
    hueA,
    hueB,
    saturationBase,
    lightBase,
    satC1,
    satC3,
    glossAlpha,
    shadowAlpha,
    primaryAxis,
    overlayAxis,
  };
}

export function generateSeededGradient(seedInput: string): SeededGradientTheme {
  const p = deriveSeededPalette(seedInput);

  return {
    primaryColors: [
      hsl(p.baseHue, p.satC1, p.lightBase + 9),
      hsl(p.hueA, p.saturationBase, p.lightBase + 2),
      hsl(p.hueB, p.satC3, p.lightBase - 9),
    ],
    overlayColors: [
      `rgba(255,255,255,${p.glossAlpha.toFixed(3)})`,
      'rgba(255,255,255,0)',
      `rgba(0,0,0,${p.shadowAlpha.toFixed(3)})`,
    ],
    primaryStart: p.primaryAxis[0],
    primaryEnd: p.primaryAxis[1],
    overlayStart: p.overlayAxis[0],
    overlayEnd: p.overlayAxis[1],
  };
}

type ClayAvatarTheme = {
  bgStart: string;
  bgEnd: string;
  bodyTop: string;
  bodyBottom: string;
  highlight: string;
};

// Palette for the clay silhouette avatar fallback. Derived from the SAME
// seeded palette as the banner so a pubkey's fallback avatar and banner
// visibly share hues: `bgStart` is exactly the banner's mid color (c2) and
// `bgEnd` deepens the banner's c3. The silhouette sits in the same hue family,
// lighter and slightly desaturated (matte clay); saturation only ever
// decreases from banner values so the result can't go neon.
export function generateClayAvatarTheme(seedInput: string): ClayAvatarTheme {
  const p = deriveSeededPalette(seedInput);
  const bodySat = p.saturationBase - 10;

  return {
    bgStart: hsl(p.hueA, p.saturationBase, p.lightBase + 2),
    bgEnd: hsl(p.hueB, p.satC3, p.lightBase - 13),
    bodyTop: hsl(p.baseHue, bodySat, Math.min(p.lightBase + 24, 80)),
    bodyBottom: hsl(p.hueA, bodySat + 4, p.lightBase + 8),
    highlight: hsl(p.baseHue, 30, 96),
  };
}

type TierRingTheme = {
  /**
   * Seamless sweep (first stop == last stop) around the ring. Metals alternate
   * light / base / deep like a turned band; gems and "new" drift through
   * neighbouring hues like a soap film.
   */
  sweep: readonly string[];
  /** Stop positions (0..1) matching `sweep`; even spacing when absent. */
  positions?: readonly number[];
  /** Where the seam of the sweep sits, in degrees — per pubkey. */
  startAngle: number;
  /** Blurred halo behind the ring. */
  glow: string;
};

type TierBase = {
  hue: number;
  sat: number;
  light: number;
  /** Hue drift of the film around the ring. */
  spread: number;
  /** 'metal' alternates light/deep bands; 'film' drifts through hues;
   *  'gem' is near-white ice with thin prismatic flashes. */
  finish: 'metal' | 'film' | 'gem';
};

// Each rung has a fixed identity hue (gold must read as gold) at the same
// matte, mid-saturation register as the clay avatar palette; everything else
// about the ring — hue drift and direction, lightness, where the seam sits —
// is drawn per pubkey so two golds are siblings, not twins.
const TIER_BASE: Record<ProfileTier, TierBase> = {
  new: { hue: 214, sat: 70, light: 64, spread: 40, finish: 'film' },
  iron: { hue: 222, sat: 10, light: 58, spread: 8, finish: 'metal' },
  bronze: { hue: 24, sat: 60, light: 54, spread: 14, finish: 'metal' },
  silver: { hue: 208, sat: 8, light: 78, spread: 8, finish: 'metal' },
  gold: { hue: 44, sat: 78, light: 60, spread: 14, finish: 'metal' },
  platinum: { hue: 170, sat: 32, light: 76, spread: 36, finish: 'film' },
  diamond: { hue: 204, sat: 55, light: 86, spread: 0, finish: 'gem' },
};

/**
 * Ring palette for a profile tier, varied per seed by the same PRNG the
 * banner and clay avatar use. Its own PRNG stream (`tier:seed`), so it adds
 * nothing to the pinned banner draw order.
 */
export function generateTierRingTheme(tier: ProfileTier, seedInput: string): TierRingTheme {
  const random = createSeededRandom(`${tier}:${seedInput}`);
  const base = TIER_BASE[tier];

  const spread = base.spread * (0.7 + random() * 0.6);
  const direction = random() > 0.5 ? 1 : -1;
  const light = base.light + (random() - 0.5) * 6;
  const startAngle = random() * 360;

  const h = (offset: number) => base.hue + offset * direction;
  if (base.finish === 'gem') {
    // Cut stone: near-white ice with two thin prismatic flashes (pink / violet
    // / cyan, then amber / green) whose place on the ring is per pubkey.
    const ice = hsl(base.hue, base.sat, light);
    const pale = hsl(base.hue, base.sat - 20, light + 8);
    const flashAt = 0.18 + random() * 0.2;
    const flash2At = flashAt + 0.4 + random() * 0.1;
    const w = 0.035;
    return {
      sweep: [
        pale,
        ice,
        hsl(325, 85, 78),
        hsl(262, 80, 74),
        hsl(190, 90, 72),
        ice,
        pale,
        hsl(42, 90, 76),
        hsl(150, 70, 74),
        ice,
        pale,
      ],
      positions: [
        0,
        flashAt - w * 1.5,
        flashAt - w * 0.5,
        flashAt,
        flashAt + w * 0.5,
        flashAt + w * 1.5,
        flash2At - w * 1.5,
        flash2At - w * 0.4,
        flash2At + w * 0.4,
        flash2At + w * 1.5,
        1,
      ],
      startAngle,
      glow: hsl(base.hue, base.sat, light - 4, 0.75),
    };
  }
  const sweep =
    base.finish === 'metal'
      ? [
          hsl(h(0), base.sat, light + 14),
          hsl(h(spread), base.sat, light),
          hsl(h(spread * 0.4), Math.max(base.sat - 8, 0), light - 16),
          hsl(h(-spread * 0.5), base.sat, light + 4),
          hsl(h(0), base.sat, light + 14),
        ]
      : [
          hsl(h(0), base.sat, light + 8),
          hsl(h(spread * 0.5), base.sat, light),
          hsl(h(spread), Math.max(base.sat - 10, 0), light + 10),
          hsl(h(spread * 0.5), base.sat, light - 6),
          hsl(h(-spread * 0.35), base.sat, light + 2),
          hsl(h(0), base.sat, light + 8),
        ];

  return {
    sweep,
    startAngle,
    glow: hsl(base.hue, base.sat, light + 4, 0.7),
  };
}
