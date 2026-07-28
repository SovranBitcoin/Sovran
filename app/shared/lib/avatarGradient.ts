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
