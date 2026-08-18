/**
 * Colour maths — one module, no dependencies.
 *
 * This replaces four separate sources that all did colour arithmetic:
 * `hex-color-opacity` (alpha), `polished` (lighten/darken), the private
 * `hexLuminance` in `themeEngine.ts`, and the inline BT.601 luma in
 * `useColorScheme.ts`. `shared/lib/colorExtraction.ts` keeps only the
 * image-to-palette work and consumes this.
 *
 * Everything here is a pure function over hex strings. Values reaching these
 * helpers come from `useThemeColor`, which resolves CSS variables to hex —
 * Uniwind formats `color-mix()` results as `#RRGGBB` or `#RRGGBBAA`, so 3-, 6-
 * and 8-digit hex are the shapes to handle.
 *
 * Parity with the packages this replaced is pinned in `__tests__/color.test.ts`
 * against golden values captured from the two npm packages before removal.
 */

const HEX_PATTERN = /^#([A-Fa-f0-9]{3}$|[A-Fa-f0-9]{6}$|[A-Fa-f0-9]{8}$)/;

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

/** Strip spurious "px" units that Uniwind sometimes injects into colour values. */
export function sanitize(value: string): string {
  return value.replace(/px/g, '');
}

/** Expand `#abc` to `abc` → `aabbcc`; drop any trailing alpha pair. */
function normalizeHex(hex: string): string {
  let body = hex.replace('#', '');

  if (body.length === 8) body = body.slice(0, 6);
  if (body.length === 3) {
    body = body[0]! + body[0]! + body[1]! + body[1]! + body[2]! + body[2]!;
  }

  return body;
}

function hexToRgb(hex: string): Rgb {
  const body = normalizeHex(hex);

  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, '0');

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Parse hex or `rgb()`/`rgba()` to RGB. Returns null if unparseable. */
function parseColor(color: string): Rgb | null {
  const cleaned = sanitize(color);

  if (HEX_PATTERN.test(cleaned)) return hexToRgb(cleaned);

  const rgb = cleaned.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) return null;

  return { r: parseInt(rgb[1]!, 10), g: parseInt(rgb[2]!, 10), b: parseInt(rgb[3]!, 10) };
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === red
      ? ((green - blue) / d + (green < blue ? 6 : 0)) / 6
      : max === green
        ? ((blue - red) / d + 2) / 6
        : ((red - green) / d + 4) / 6;

  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const value = l * 255;
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  const channel = (t: number) => {
    let shifted = t;
    if (shifted < 0) shifted += 1;
    if (shifted > 1) shifted -= 1;
    if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
    if (shifted < 1 / 2) return q;
    if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
    return p;
  };

  return { r: channel(h + 1 / 3) * 255, g: channel(h) * 255, b: channel(h - 1 / 3) * 255 };
}

/** HSL of a hex colour, each component 0-1. */
export function toHsl(hex: string): Hsl {
  return rgbToHsl(hexToRgb(hex));
}

/**
 * Perceived brightness, 0 (black) to 1 (white), using the ITU-R BT.601 luma
 * weights. The single implementation — `themeEngine` and `useColorScheme` both
 * call this.
 */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);

  return 0.299 * (r / 255) + 0.587 * (g / 255) + 0.114 * (b / 255);
}

/**
 * Apply an alpha channel to a hex colour, returning `#RRGGBBAA`.
 *
 * Behaviour is inherited from the package this replaced: an existing alpha pair
 * on the input is discarded rather than multiplied, output is upper-cased, and
 * invalid input throws rather than rendering something arbitrary. 486 call sites
 * depend on that contract.
 */
export function withAlpha(hex: string, alpha: number): string {
  if (typeof hex !== 'string' || !HEX_PATTERN.test(hex)) {
    throw new Error(`Invalid hexadecimal color value: ${String(hex)}`);
  }
  if (typeof alpha !== 'number' || alpha > 1 || alpha < 0) {
    throw new Error(`Opacity should be a float between 0 and 1: ${String(alpha)}`);
  }

  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');

  return `#${normalizeHex(hex)}${channel}`.toUpperCase();
}

function shiftLightness(hex: string, delta: number): string {
  const { h, s, l } = toHsl(hex);
  const shifted = rgbToHex(hslToRgb({ h, s, l: Math.min(1, Math.max(0, l + delta)) }));

  // Carry an input alpha pair through rather than silently dropping it.
  const body = hex.replace('#', '');

  return body.length === 8 ? `${shifted}${body.slice(6)}` : shifted;
}

/** Raise lightness by `amount` (0-1) in HSL space. Replaces `polished/lighten`. */
export function lighten(hex: string, amount: number): string {
  return shiftLightness(hex, amount);
}

/** Lower lightness by `amount` (0-1) in HSL space. Replaces `polished/darken`. */
export function darken(hex: string, amount: number): string {
  return shiftLightness(hex, -amount);
}

/** Blend two colours. `amount` 0 = base, 1 = accent. Returns opaque hex. */
export function blend(base: string, accent: string, amount: number): string {
  const a = parseColor(base);
  const b = parseColor(accent);

  if (!a || !b) return base.startsWith('#') ? base : '#1a1a1a';

  return rgbToHex({
    r: a.r * (1 - amount) + b.r * amount,
    g: a.g * (1 - amount) + b.g * amount,
    b: a.b * (1 - amount) + b.b * amount,
  });
}

/**
 * Pick a readable companion colour for `hex`: lighten it when it is dark,
 * darken it when it is light, and fall back to lightening when darkening would
 * not move far enough to be visible.
 */
export function getContrastColors(
  hex: string,
  amount = 0.3
): { contrastColor: string; borderColor: string } {
  const base = luminance(hex);

  if (base < 0.3) {
    const lightened = lighten(hex, amount);
    return { contrastColor: lightened, borderColor: lightened };
  }

  const darkened = darken(hex, amount);

  if (Math.abs(base - luminance(darkened)) < 0.1) {
    const lightened = lighten(hex, amount);
    return { contrastColor: lightened, borderColor: lightened };
  }

  return { contrastColor: darkened, borderColor: hex };
}
