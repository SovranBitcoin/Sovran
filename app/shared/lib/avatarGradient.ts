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

/** One soft colour blob drifting around the band. All motion terms are
 *  integer multiples of one loop so the film is seamless at the wrap. */
export type TierRingBlob = {
  color: string;
  /** Start angle, radians. */
  angle: number;
  /** Whole turns per loop; sign is direction. */
  turns: number;
  /** Wobble amplitude (radians) and whole cycles per loop. */
  wobble: number;
  wobbleCycles: number;
  /** Radius as a multiple of the band width, and breathing cycles per loop. */
  radius: number;
  breathCycles: number;
  phase: number;
};

type TierRingTheme = {
  /** The band's own colour under the blobs. */
  base: string;
  blobs: readonly TierRingBlob[];
  /** Blurred halo behind the ring. */
  glow: string;
};

type TierBase = {
  hue: number;
  sat: number;
  light: number;
  /** Hue drift of the film's blobs. */
  spread: number;
  /** 'metal' tints of one hue; 'film' drifts through hues; 'gem' is
   *  near-white ice with prismatic flashes. */
  finish: 'metal' | 'film' | 'gem';
};

// Each rung has a fixed identity hue (gold must read as gold) at the same
// matte, mid-saturation register as the clay avatar palette; everything else
// about the ring — where the blobs start, how fast and which way they drift,
// how they breathe — is drawn per pubkey so two golds are siblings, not twins.
const TIER_BASE: Record<ProfileTier, TierBase> = {
  new: { hue: 214, sat: 70, light: 62, spread: 50, finish: 'film' },
  iron: { hue: 222, sat: 10, light: 56, spread: 8, finish: 'metal' },
  bronze: { hue: 24, sat: 60, light: 52, spread: 16, finish: 'metal' },
  silver: { hue: 208, sat: 8, light: 76, spread: 8, finish: 'metal' },
  gold: { hue: 44, sat: 78, light: 58, spread: 16, finish: 'metal' },
  platinum: { hue: 170, sat: 32, light: 74, spread: 44, finish: 'film' },
  diamond: { hue: 204, sat: 55, light: 86, spread: 0, finish: 'gem' },
};

const TAU = Math.PI * 2;

/**
 * Ring palette and blob choreography for a profile tier, varied per seed by
 * the same PRNG the banner and clay avatar use. Its own PRNG stream
 * (`tier:seed`), so it adds nothing to the pinned banner draw order.
 */
export function generateTierRingTheme(tier: ProfileTier, seedInput: string): TierRingTheme {
  const random = createSeededRandom(`${tier}:${seedInput}`);
  const base = TIER_BASE[tier];
  const light = base.light + (random() - 0.5) * 6;
  const direction = random() > 0.5 ? 1 : -1;
  const h = (offset: number) => base.hue + offset * direction;

  const colors: string[] =
    base.finish === 'metal'
      ? [
          hsl(h(0), base.sat, light + 18),
          hsl(h(base.spread), Math.max(base.sat - 6, 0), light - 14),
          hsl(0, 0, 100),
          hsl(h(-base.spread * 0.6), base.sat, light + 8),
          hsl(h(base.spread * 0.4), base.sat, light - 6),
        ]
      : base.finish === 'film'
        ? [
            hsl(h(base.spread), base.sat, light + 10),
            hsl(h(-base.spread * 0.7), base.sat, light + 4),
            hsl(h(base.spread * 1.6), Math.max(base.sat - 10, 0), light + 12),
            hsl(0, 0, 100),
            hsl(h(base.spread * 0.3), base.sat, light - 8),
          ]
        : [hsl(325, 85, 78), hsl(262, 80, 74), hsl(190, 90, 72), hsl(42, 90, 76), hsl(0, 0, 100)];

  const blobs: TierRingBlob[] = colors.map((color, index) => {
    const turns = (1 + Math.floor(random() * 2)) * (random() > 0.5 ? 1 : -1);
    return {
      color,
      angle: random() * TAU,
      turns,
      wobble: 0.25 + random() * 0.35,
      wobbleCycles: 2 + Math.floor(random() * 3),
      radius: (index === colors.length - 1 ? 0.9 : 1.4) + random() * 0.6,
      breathCycles: 1 + Math.floor(random() * 3),
      phase: random() * TAU,
    };
  });

  return {
    base:
      base.finish === 'gem'
        ? hsl(base.hue, base.sat - 20, light)
        : hsl(base.hue, base.sat, base.finish === 'metal' ? light : light - 2),
    blobs,
    glow: hsl(base.hue, base.sat, light + 4, base.finish === 'gem' ? 0.75 : 0.7),
  };
}
