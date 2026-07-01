/**
 * @fileoverview Keyframe timeline for the permission gesture demo
 *
 * Pure data + a pure evaluator — deliberately ZERO imports (no reanimated)
 * so the loop-seam and monotonicity invariants are jest-testable without
 * mocking, and the whole choreography is reviewable in one table.
 *
 * One master clock `t` (ms, 0 → CYCLE_MS, repeating) drives every element;
 * each element samples its Track via `valueAt`. The non-negotiable invariant:
 * every track's value at 0 equals its value at CYCLE_MS, so the infinite
 * loop has no visible seam (pinned by permissionGestureDemoTimeline.test).
 *
 * Beats (scene 280×104; mock row x 20–260 / y 40–96; press point (172, 68);
 * glove coordinates are the FINGERTIP):
 *      0– 800  idle bob, row in Ask
 *    800–1320  tap 1 → switch ON ("Always")
 *   1320–1800  settle
 *   1800–2320  tap 2 → switch OFF ("Ask")
 *   2320–2700  settle
 *   2700–3680  long-press hold (squash + hold ring sweep)
 *   3680–3800  ring pops, release
 *   3800–4900  mini menu in → glove taps Block (danger flash) → menu out
 *   4900–5400  RED REVEAL: row flips to Blocked (red title/status/track)
 *   5400–6100  blocked beat
 *   6100–6520  row plane fades out, state resets invisibly, fades back in
 *   6520–6800  idle tail (bob phase-continuous: 6800 / BOB_PERIOD is whole)
 */

export const CYCLE_MS = 6800;

/** Glove idle bob: BOB_AMP * sin(2πt / BOB_PERIOD), gated by BOB_WEIGHT. */
export const BOB_PERIOD_MS = 850;
export const BOB_AMP = 3;

type EasingKey = 'linear' | 'outCubic' | 'inQuad' | 'outQuad' | 'overshoot' | 'inOutSin';

interface TimelineKeyframe {
  at: number;
  v: number;
  /** Easing INTO this keyframe from the previous one. Default linear. */
  e?: EasingKey;
}

export type Track = readonly TimelineKeyframe[];

export type EasingMap = Record<EasingKey, (x: number) => number>;

/**
 * Sample a track at time `t` (clamped to the first/last keyframe values).
 * Linear scan — tracks are ≤ 16 frames; runs per-frame on the UI thread.
 */
export function valueAt(t: number, track: Track, easings: EasingMap): number {
  'worklet';
  const first = track[0]!;
  if (t <= first.at) return first.v;
  for (let i = 1; i < track.length; i += 1) {
    const next = track[i]!;
    if (t <= next.at) {
      const prev = track[i - 1]!;
      const span = next.at - prev.at;
      if (span <= 0) return next.v;
      const local = (t - prev.at) / span;
      return prev.v + (next.v - prev.v) * easings[next.e ?? 'linear'](local);
    }
  }
  return track[track.length - 1]!.v;
}

// ── Scene geometry ──────────────────────────────────────────────

export const SCENE_W = 280;
export const SCENE_H = 104;
export const ROW_LEFT = 20;
export const ROW_TOP = 40;
export const ROW_W = 240;
export const ROW_H = 56;
export const PRESS_X = 172;
export const PRESS_Y = 68;
/** Row plane idle pose — the card is never flat. */
export const RX_IDLE = 8;
export const RY_IDLE = -6;

// ── Tracks ──────────────────────────────────────────────────────

/** Glove fingertip X. Drifts right to hover/tap the mini menu. */
const GLOVE_X: Track = [
  { at: 0, v: 172 },
  { at: 3800, v: 172 },
  { at: 4080, v: 196, e: 'outCubic' },
  { at: 4680, v: 196 },
  { at: 5000, v: 172, e: 'inOutSin' },
  { at: CYCLE_MS, v: 172 },
];

/** Glove fingertip Y (idle hover 36; row contact 58; menu rows ~72-78). */
const GLOVE_Y: Track = [
  { at: 0, v: 36 },
  { at: 800, v: 36 },
  { at: 960, v: 58, e: 'inQuad' },
  { at: 1080, v: 58 },
  { at: 1320, v: 36, e: 'outCubic' },
  { at: 1800, v: 36 },
  { at: 1960, v: 58, e: 'inQuad' },
  { at: 2080, v: 58 },
  { at: 2320, v: 36, e: 'outCubic' },
  { at: 2700, v: 36 },
  { at: 2860, v: 58, e: 'inQuad' },
  { at: 3680, v: 58 },
  { at: 3800, v: 44, e: 'outCubic' },
  { at: 4080, v: 30, e: 'outCubic' },
  { at: 4380, v: 30 },
  { at: 4520, v: 72, e: 'inOutSin' },
  { at: 4600, v: 78, e: 'inQuad' },
  { at: 4680, v: 72, e: 'outCubic' },
  { at: 5000, v: 36, e: 'inOutSin' },
  { at: CYCLE_MS, v: 36 },
];

/** Squash-and-stretch: widen on contact… */
const GLOVE_SCALE_X: Track = [
  { at: 0, v: 1 },
  { at: 960, v: 1 },
  { at: 1040, v: 1.07, e: 'outCubic' },
  { at: 1300, v: 1, e: 'overshoot' },
  { at: 1960, v: 1 },
  { at: 2040, v: 1.07, e: 'outCubic' },
  { at: 2300, v: 1, e: 'overshoot' },
  { at: 2860, v: 1 },
  { at: 2980, v: 1.08, e: 'outCubic' },
  { at: 3680, v: 1.08 },
  { at: 3800, v: 1, e: 'overshoot' },
  { at: 4520, v: 1 },
  { at: 4600, v: 1.05, e: 'outCubic' },
  { at: 4760, v: 1, e: 'overshoot' },
  { at: CYCLE_MS, v: 1 },
];

/** …and compress vertically (deeper while the long-press holds). */
const GLOVE_SCALE_Y: Track = [
  { at: 0, v: 1 },
  { at: 960, v: 1 },
  { at: 1040, v: 0.86, e: 'outCubic' },
  { at: 1300, v: 1, e: 'overshoot' },
  { at: 1960, v: 1 },
  { at: 2040, v: 0.86, e: 'outCubic' },
  { at: 2300, v: 1, e: 'overshoot' },
  { at: 2860, v: 1 },
  { at: 2980, v: 0.82, e: 'outCubic' },
  { at: 3680, v: 0.82 },
  { at: 3800, v: 1, e: 'overshoot' },
  { at: 4520, v: 1 },
  { at: 4600, v: 0.88, e: 'outCubic' },
  { at: 4760, v: 1, e: 'overshoot' },
  { at: CYCLE_MS, v: 1 },
];

/** Slight lean while reaching for the menu's Block row. */
const GLOVE_ROTATE_DEG: Track = [
  { at: 0, v: 0 },
  { at: 4380, v: 0 },
  { at: 4520, v: -8, e: 'inOutSin' },
  { at: 4680, v: -8 },
  { at: 5000, v: 0, e: 'inOutSin' },
  { at: CYCLE_MS, v: 0 },
];

/** Gates the sine bob off during press beats (sin(0)=0 keeps the seam). */
const BOB_WEIGHT: Track = [
  { at: 0, v: 1 },
  { at: 800, v: 1 },
  { at: 900, v: 0, e: 'outQuad' },
  { at: 1320, v: 0 },
  { at: 1500, v: 1, e: 'outQuad' },
  { at: 1800, v: 1 },
  { at: 1900, v: 0, e: 'outQuad' },
  { at: 2320, v: 0 },
  { at: 2500, v: 1, e: 'outQuad' },
  { at: 2700, v: 1 },
  { at: 2800, v: 0, e: 'outQuad' },
  { at: 5000, v: 0 },
  { at: 5300, v: 1, e: 'outQuad' },
  { at: CYCLE_MS, v: 1 },
];

/** Contact shadow under the fingertip (opacity 0.08 hover ↔ 0.18 pressed). */
const SHADOW_OPACITY: Track = [
  { at: 0, v: 0.08 },
  { at: 800, v: 0.08 },
  { at: 960, v: 0.18, e: 'inQuad' },
  { at: 1080, v: 0.18 },
  { at: 1320, v: 0.08, e: 'outCubic' },
  { at: 1800, v: 0.08 },
  { at: 1960, v: 0.18, e: 'inQuad' },
  { at: 2080, v: 0.18 },
  { at: 2320, v: 0.08, e: 'outCubic' },
  { at: 2700, v: 0.08 },
  { at: 2860, v: 0.18, e: 'inQuad' },
  { at: 3680, v: 0.18 },
  { at: 3800, v: 0.14, e: 'outCubic' },
  { at: 4080, v: 0.1, e: 'outCubic' },
  { at: 4520, v: 0.16, e: 'inQuad' },
  { at: 4680, v: 0.16 },
  { at: 5000, v: 0.08, e: 'outCubic' },
  { at: CYCLE_MS, v: 0.08 },
];

const SHADOW_SCALE_X: Track = [
  { at: 0, v: 0.7 },
  { at: 800, v: 0.7 },
  { at: 960, v: 1, e: 'inQuad' },
  { at: 1320, v: 0.7, e: 'outCubic' },
  { at: 1800, v: 0.7 },
  { at: 1960, v: 1, e: 'inQuad' },
  { at: 2320, v: 0.7, e: 'outCubic' },
  { at: 2700, v: 0.7 },
  { at: 2860, v: 1, e: 'inQuad' },
  { at: 3680, v: 1 },
  { at: 5000, v: 0.7, e: 'outCubic' },
  { at: CYCLE_MS, v: 0.7 },
];

/** Row plane tilt — presses tilt the card toward the finger. */
const ROW_RX: Track = [
  { at: 0, v: RX_IDLE },
  { at: 960, v: RX_IDLE },
  { at: 1080, v: 5.5, e: 'outCubic' },
  { at: 1400, v: RX_IDLE, e: 'overshoot' },
  { at: 1960, v: RX_IDLE },
  { at: 2080, v: 5.5, e: 'outCubic' },
  { at: 2400, v: RX_IDLE, e: 'overshoot' },
  { at: 2860, v: RX_IDLE },
  { at: 2980, v: 4.5, e: 'outCubic' },
  { at: 3680, v: 4.5 },
  { at: 4000, v: RX_IDLE, e: 'overshoot' },
  { at: CYCLE_MS, v: RX_IDLE },
];

const ROW_RY: Track = [
  { at: 0, v: RY_IDLE },
  { at: 960, v: RY_IDLE },
  { at: 1080, v: -2, e: 'outCubic' },
  { at: 1400, v: RY_IDLE, e: 'overshoot' },
  { at: 1960, v: RY_IDLE },
  { at: 2080, v: -2, e: 'outCubic' },
  { at: 2400, v: RY_IDLE, e: 'overshoot' },
  { at: 2860, v: RY_IDLE },
  { at: 2980, v: 0, e: 'outCubic' },
  { at: 3680, v: 0 },
  { at: 4000, v: RY_IDLE, e: 'overshoot' },
  { at: CYCLE_MS, v: RY_IDLE },
];

const ROW_DEPRESS: Track = [
  { at: 0, v: 0 },
  { at: 960, v: 0 },
  { at: 1080, v: 2, e: 'outCubic' },
  { at: 1400, v: 0, e: 'overshoot' },
  { at: 1960, v: 0 },
  { at: 2080, v: 2, e: 'outCubic' },
  { at: 2400, v: 0, e: 'overshoot' },
  { at: 2860, v: 0 },
  { at: 2980, v: 2.5, e: 'outCubic' },
  { at: 3680, v: 2.5 },
  { at: 4000, v: 0, e: 'overshoot' },
  { at: CYCLE_MS, v: 0 },
];

/** Micro-thunk when the block lands. */
const ROW_THUNK_SCALE: Track = [
  { at: 0, v: 1 },
  { at: 4900, v: 1 },
  { at: 5020, v: 0.985, e: 'inQuad' },
  { at: 5150, v: 1, e: 'outCubic' },
  { at: CYCLE_MS, v: 1 },
];

/** Row plane opacity — the invisible window where state resets. */
const ROW_FADE: Track = [
  { at: 0, v: 1 },
  { at: 6100, v: 1 },
  { at: 6320, v: 0, e: 'inQuad' },
  { at: 6520, v: 1, e: 'outQuad' },
  { at: CYCLE_MS, v: 1 },
];

/** Switch knob translateX (0 = Ask/off, 14 = on). */
const KNOB_X: Track = [
  { at: 0, v: 0 },
  { at: 1080, v: 0 },
  { at: 1320, v: 14, e: 'overshoot' },
  { at: 2080, v: 14 },
  { at: 2320, v: 0, e: 'overshoot' },
  { at: 4900, v: 0 },
  { at: 5250, v: 14, e: 'overshoot' },
  { at: 6140, v: 14 },
  { at: 6300, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/** Track tint OFF→ON for the Allow toggle (red lives on RED_P). */
const TRACK_ON: Track = [
  { at: 0, v: 0 },
  { at: 1080, v: 0 },
  { at: 1320, v: 1, e: 'outCubic' },
  { at: 2080, v: 1 },
  { at: 2320, v: 0, e: 'outCubic' },
  { at: CYCLE_MS, v: 0 },
];

/** The red reveal — drives track color, title/status danger twins. */
const RED_P: Track = [
  { at: 0, v: 0 },
  { at: 4900, v: 0 },
  { at: 5250, v: 1, e: 'outCubic' },
  { at: 6140, v: 1 },
  { at: 6300, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

const STATUS_ASK: Track = [
  { at: 0, v: 1 },
  { at: 1080, v: 1 },
  { at: 1280, v: 0, e: 'inQuad' },
  { at: 2080, v: 0 },
  { at: 2280, v: 1, e: 'outQuad' },
  { at: 4900, v: 1 },
  { at: 5100, v: 0, e: 'inQuad' },
  { at: 6140, v: 0 },
  { at: 6300, v: 1, e: 'outQuad' },
  { at: CYCLE_MS, v: 1 },
];

const STATUS_ALWAYS: Track = [
  { at: 0, v: 0 },
  { at: 1080, v: 0 },
  { at: 1280, v: 1, e: 'outQuad' },
  { at: 2080, v: 1 },
  { at: 2280, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

const STATUS_BLOCKED: Track = [
  { at: 0, v: 0 },
  { at: 4900, v: 0 },
  { at: 5100, v: 1, e: 'outQuad' },
  { at: 6140, v: 1 },
  { at: 6300, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/** Long-press hold ring (around the fingertip). */
const RING_OPACITY: Track = [
  { at: 0, v: 0 },
  { at: 2860, v: 0 },
  { at: 2980, v: 1, e: 'outQuad' },
  { at: 3680, v: 1 },
  { at: 3800, v: 0, e: 'outQuad' },
  { at: CYCLE_MS, v: 0 },
];

const RING_SWEEP: Track = [
  { at: 0, v: 0 },
  { at: 2880, v: 0 },
  { at: 3680, v: 1, e: 'outQuad' },
  { at: 3810, v: 1 },
  { at: 3960, v: 0, e: 'linear' }, // invisible reset (opacity already 0)
  { at: CYCLE_MS, v: 0 },
];

const RING_SCALE: Track = [
  { at: 0, v: 1 },
  { at: 3680, v: 1 },
  { at: 3800, v: 1.3, e: 'outCubic' },
  { at: 3960, v: 1 }, // invisible reset
  { at: CYCLE_MS, v: 1 },
];

/** Mini menu card (pops in after the hold, leaves after Block is tapped). */
const MENU_SCALE: Track = [
  { at: 0, v: 0.6 },
  { at: 3800, v: 0.6 },
  { at: 4080, v: 1, e: 'overshoot' },
  { at: 4680, v: 1 },
  { at: 4900, v: 0.92, e: 'inQuad' },
  { at: 5000, v: 0.6 }, // invisible reset
  { at: CYCLE_MS, v: 0.6 },
];

const MENU_OPACITY: Track = [
  { at: 0, v: 0 },
  { at: 3800, v: 0 },
  { at: 3960, v: 1, e: 'outQuad' },
  { at: 4680, v: 1 },
  { at: 4900, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/**
 * Per-menu-row entrance (0→1). Row i samples this at `t − 60·i` for the
 * stagger; the wrapper's MENU_OPACITY owns the exit, so this only enters.
 */
const MENU_ROW_IN: Track = [
  { at: 0, v: 0 },
  { at: 3800, v: 0 },
  { at: 3980, v: 1, e: 'outCubic' },
  { at: 6100, v: 1 },
  { at: 6300, v: 0, e: 'inQuad' }, // invisible reset inside the row-fade window
  { at: CYCLE_MS, v: 0 },
];

/** Danger flash on the menu's Block row as the glove taps it. */
const BLOCK_FLASH: Track = [
  { at: 0, v: 0 },
  { at: 4520, v: 0 },
  { at: 4590, v: 0.15, e: 'outQuad' },
  { at: 4680, v: 0, e: 'outQuad' },
  { at: CYCLE_MS, v: 0 },
];

// ── Beat words (top-left callouts; overshoot pops past 1 for the bounce) ──

/** "Tap!" — lands with the first contact. */
const WORD_TAP_1: Track = [
  { at: 0, v: 0 },
  { at: 960, v: 0 },
  { at: 1100, v: 1, e: 'overshoot' },
  { at: 1700, v: 1 },
  { at: 1800, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/** "Tap back!" — the second tap undoes the first. */
const WORD_TAP_2: Track = [
  { at: 0, v: 0 },
  { at: 1960, v: 0 },
  { at: 2100, v: 1, e: 'overshoot' },
  { at: 2600, v: 1 },
  { at: 2700, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/** "Hold…" — rides the whole long-press while the ring sweeps. */
const WORD_HOLD: Track = [
  { at: 0, v: 0 },
  { at: 2860, v: 0 },
  { at: 3000, v: 1, e: 'overshoot' },
  { at: 3760, v: 1 },
  { at: 3860, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/** "Block!" — lands with the red reveal, exits before the fade reset. */
const WORD_BLOCK: Track = [
  { at: 0, v: 0 },
  { at: 4900, v: 0 },
  { at: 5050, v: 1, e: 'overshoot' },
  { at: 6050, v: 1 },
  { at: 6150, v: 0, e: 'inQuad' },
  { at: CYCLE_MS, v: 0 },
];

/** Every track, keyed for tests (seam + monotonicity invariants). */
export const DEMO_TRACKS = {
  GLOVE_X,
  GLOVE_Y,
  GLOVE_SCALE_X,
  GLOVE_SCALE_Y,
  GLOVE_ROTATE_DEG,
  BOB_WEIGHT,
  SHADOW_OPACITY,
  SHADOW_SCALE_X,
  ROW_RX,
  ROW_RY,
  ROW_DEPRESS,
  ROW_THUNK_SCALE,
  ROW_FADE,
  KNOB_X,
  TRACK_ON,
  RED_P,
  STATUS_ASK,
  STATUS_ALWAYS,
  STATUS_BLOCKED,
  RING_OPACITY,
  RING_SWEEP,
  RING_SCALE,
  MENU_SCALE,
  MENU_OPACITY,
  MENU_ROW_IN,
  BLOCK_FLASH,
  WORD_TAP_1,
  WORD_TAP_2,
  WORD_HOLD,
  WORD_BLOCK,
} as const satisfies Record<string, Track>;
