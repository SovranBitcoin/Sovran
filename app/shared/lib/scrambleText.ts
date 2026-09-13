/**
 * The "decrypting text" effect: every glyph cycles through random characters,
 * then settles left → right onto the real string as `progress` runs 0 → 1.
 *
 * Pure and a worklet — `ScrambleText` calls it from `useAnimatedProps` on the
 * UI thread every tick, so it must not touch JS-thread state, `Math.random`
 * (non-deterministic per glyph between ticks would flicker), or allocations
 * beyond the output string.
 */

const SCRAMBLE_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** How long a value takes to settle once known. Shared by every cosmetic
 * decode that plays when a payload lands — the copy row's glyphs and the QR's
 * junk wipe — so they start and finish together. */
export const SCRAMBLE_DECODE_MS = 640;

/** Cheap integer hash so a glyph holds one random character for a whole tick
 * and every glyph differs within a tick. */
function glyphHash(tick: number, index: number): number {
  'worklet';
  let h = (Math.imul(tick + 1, 0x9e3779b1) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  // XOR yields a signed int32; force unsigned so the modulo never goes negative.
  return (h ^ (h >>> 12)) >>> 0;
}

/**
 * One frame of the scramble. `target` is the string to settle on (`''` keeps
 * scrambling forever); `length` is how many glyphs to draw (the target's
 * length once known, else the placeholder width); `tick` advances the random
 * characters; `progress` (0..1) is how much of the target has settled.
 * Spaces in the target stay spaces so word shapes hold while decoding.
 */
export function scrambleFrame(
  target: string,
  length: number,
  tick: number,
  progress: number
): string {
  'worklet';
  const settled = Math.floor(Math.min(1, Math.max(0, progress)) * length + 1e-6);
  let out = '';
  for (let i = 0; i < length; i++) {
    const real = target[i] ?? '';
    if (i < settled || real === ' ') {
      out += real;
      continue;
    }
    out += SCRAMBLE_CHARSET[glyphHash(tick, i) % SCRAMBLE_CHARSET.length];
  }
  return out;
}
