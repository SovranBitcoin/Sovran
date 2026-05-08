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

export function generateSeededGradient(seedInput: string): SeededGradientTheme {
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

  const c1 = hsl(baseHue, saturationBase - 6 + random() * 6, lightBase + 9);
  const c2 = hsl(hueA, saturationBase, lightBase + 2);
  const c3 = hsl(hueB, saturationBase - 8 + random() * 6, lightBase - 9);

  const gloss = `rgba(255,255,255,${(0.14 + random() * 0.12).toFixed(3)})`;
  const shadow = `rgba(0,0,0,${(0.16 + random() * 0.12).toFixed(3)})`;

  const axes: ReadonlyArray<readonly [GradientPoint, GradientPoint]> = [
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

  const primaryAxis = axes[Math.floor(random() * axes.length)];
  const overlayAxis = axes[Math.floor(random() * axes.length)];

  return {
    primaryColors: [c1, c2, c3],
    overlayColors: [gloss, 'rgba(255,255,255,0)', shadow],
    primaryStart: primaryAxis[0],
    primaryEnd: primaryAxis[1],
    overlayStart: overlayAxis[0],
    overlayEnd: overlayAxis[1],
  };
}
