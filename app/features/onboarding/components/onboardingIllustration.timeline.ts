import type { Track } from '@/shared/lib/motion/keyframes';

export const ILLUSTRATION_CYCLE_MS = 4800;

/** Move once, pause to read, then return behind a fade. */
export const TRAVEL: Track = [
  { at: 0, v: -76 },
  { at: 600, v: -76 },
  { at: 2000, v: 76, e: 'inOutSin' },
  { at: 3800, v: 76 },
  { at: 4200, v: -76 },
  { at: ILLUSTRATION_CYCLE_MS, v: -76 },
];
export const TRAVEL_OPACITY: Track = [
  { at: 0, v: 1 },
  { at: 3400, v: 1 },
  { at: 3800, v: 0, e: 'outQuad' },
  { at: 4200, v: 0 },
  { at: ILLUSTRATION_CYCLE_MS, v: 1, e: 'outQuad' },
];
export const DETAIL_OPACITY: Track = [
  { at: 0, v: 0.25 },
  { at: 600, v: 0.25 },
  { at: 2000, v: 1, e: 'inOutSin' },
  { at: 3400, v: 1 },
  { at: 4400, v: 0.25, e: 'inOutSin' },
  { at: ILLUSTRATION_CYCLE_MS, v: 0.25 },
];
