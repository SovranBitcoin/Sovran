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
  /** Ring stroke gradient, light → base → deep. */
  colors: readonly [string, string, string];
  start: GradientPoint;
  end: GradientPoint;
  /** Coin-rim lettering: the tier's deep tone. */
  label: string;
  /** Soft halo behind the ring. */
  halo: string;
};

type TierBase = { hue: number; sat: number; light: number; spread: number };

// Each rung has a fixed identity hue (gold must read as gold) at the same
// matte, mid-saturation register as the clay avatar palette; everything else
// about the ring — hue spread and direction, lightness, gradient axis — is
// drawn per pubkey so two golds are siblings, not twins.
const TIER_BASE: Record<ProfileTier, TierBase> = {
  new: { hue: 214, sat: 64, light: 64, spread: 18 },
  iron: { hue: 222, sat: 10, light: 58, spread: 10 },
  bronze: { hue: 22, sat: 54, light: 56, spread: 14 },
  silver: { hue: 208, sat: 8, light: 76, spread: 10 },
  gold: { hue: 44, sat: 70, light: 60, spread: 12 },
  platinum: { hue: 168, sat: 28, light: 74, spread: 16 },
  diamond: { hue: 196, sat: 64, light: 70, spread: 40 },
};

/**
 * Ring palette for a profile tier, varied per seed by the same PRNG the
 * banner and clay avatar use. Its own PRNG stream (`tier:seed`), so it adds
 * nothing to the pinned banner draw order.
 */
export function generateTierRingTheme(tier: ProfileTier, seedInput: string): TierRingTheme {
  const random = createSeededRandom(`${tier}:${seedInput}`);
  const base = TIER_BASE[tier];

  const spread = base.spread * (0.6 + random() * 0.8);
  const direction = random() > 0.5 ? 1 : -1;
  const lightJitter = (random() - 0.5) * 6;
  const axis = AXES[Math.floor(random() * AXES.length)]!;

  const hueA = base.hue + spread * direction;
  const hueB = base.hue - spread * 0.6 * direction;
  const light = base.light + lightJitter;

  return {
    colors: [
      hsl(hueA, base.sat, light + 10),
      hsl(base.hue, base.sat, light),
      hsl(hueB, Math.max(base.sat - 6, 0), light - 9),
    ],
    start: axis[0],
    end: axis[1],
    label: hsl(base.hue, Math.min(base.sat + 10, 80), Math.max(light - 30, 18)),
    halo: hsl(base.hue, base.sat, light, 0.28),
  };
}
