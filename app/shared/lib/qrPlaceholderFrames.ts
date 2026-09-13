/**
 * Junk QR frames for the loading placeholder — never real data.
 *
 * Every frame is a different pseudo-random payload of the SAME length, so all
 * frames share one QR version (module count) and cycling them reads as a
 * live, shimmering code of the density the real request will have. Frames
 * are generated once per (length, size) and cached for the session: the
 * placeholder must not re-encode on the JS thread while it plays, because it
 * plays precisely while the JS thread is busy building the real payload.
 */

import { create as createQrCode } from 'qrcode';

export const QR_PLACEHOLDER_FRAME_COUNT = 6;
/** Mirrors react-native-qrcode-svg's default so the junk lands in the same
 * QR version as the live code encoded from a payload of equal length. */
const QR_PLACEHOLDER_ECL = 'M';
/** Byte mode caps out at ~2.3k chars for version 40 at ECL M; the live QR
 * splits anything longer into UR fragments anyway. */
const MAX_PLACEHOLDER_LENGTH = 2000;
const MIN_PLACEHOLDER_LENGTH = 8;
/** Lowercase letters force byte mode — the mode a `bitcoin:` URI, creq, or
 * offer encodes in — so `length` maps to the same QR version as real data.
 * Digit-only junk packs three digits per ten bits and renders a far sparser
 * code than the payload it stands in for. */
const JUNK_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export interface QrPlaceholderFrame {
  /** SVG path: one horizontal stroke per run of dark modules. */
  d: string;
  /** Stroke width = module edge in points. */
  cellSize: number;
  /** Modules per side (QR version 1 = 21). */
  modules: number;
}

/** Deterministic junk of `length` chars for `seed` (an LCG — no crypto, no
 * meaning). Same seed → same string, so cached frames are stable. */
export function qrJunkPayload(seed: number, length: number): string {
  let state = Math.imul(seed + 1, 0x9e3779b1) >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out += JUNK_CHARSET[(state >>> 16) % JUNK_CHARSET.length];
  }
  return out;
}

/** The same run-length path react-native-qrcode-svg draws for a module
 * matrix (`M x y L x y` per run, stroked at `cellSize`), so the placeholder
 * renders with the live QR's exact stroke geometry. */
export function qrMatrixPath(
  data: ArrayLike<number>,
  modules: number,
  size: number
): { d: string; cellSize: number } {
  const cellSize = size / modules;
  let d = '';
  for (let row = 0; row < modules; row++) {
    const y = cellSize / 2 + cellSize * row;
    let drawing = false;
    for (let col = 0; col < modules; col++) {
      if (data[row * modules + col]) {
        if (!drawing) {
          d += `M${cellSize * col} ${y} `;
          drawing = true;
        }
        if (col === modules - 1) d += `L${cellSize * modules} ${y} `;
      } else if (drawing) {
        d += `L${cellSize * col} ${y} `;
        drawing = false;
      }
    }
  }
  return { d, cellSize };
}

function qrPlaceholderFrame(payload: string, size: number): QrPlaceholderFrame {
  const { modules } = createQrCode(payload, { errorCorrectionLevel: QR_PLACEHOLDER_ECL });
  return { modules: modules.size, ...qrMatrixPath(modules.data, modules.size, size) };
}

const frameCache = new Map<string, readonly QrPlaceholderFrame[]>();

/** `count` junk frames mimicking a payload of `length` chars drawn at `size`
 * points. Cached per (length, size, count). */
export function qrPlaceholderFrames(
  length: number,
  size: number,
  count = QR_PLACEHOLDER_FRAME_COUNT
): readonly QrPlaceholderFrame[] {
  const junkLength = Math.min(
    MAX_PLACEHOLDER_LENGTH,
    Math.max(MIN_PLACEHOLDER_LENGTH, Math.round(length))
  );
  const key = `${junkLength}:${size}:${count}`;
  const cached = frameCache.get(key);
  if (cached) return cached;
  const frames = Array.from({ length: count }, (_, seed) =>
    qrPlaceholderFrame(qrJunkPayload(seed, junkLength), size)
  );
  frameCache.set(key, frames);
  return frames;
}

/** Test seam. */
export function resetQrPlaceholderFrameCache(): void {
  frameCache.clear();
}
