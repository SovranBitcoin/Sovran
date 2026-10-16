/**
 * Keyframe tracks for looping illustrations driven by one master clock.
 *
 * Pure data types and a pure evaluator, with no imports, so every track's
 * loop seam and ordering can be tested without mocking reanimated. The clock
 * itself is `useLoopClock`; the easing functions are `KEYFRAME_EASINGS`.
 */

export type EasingKey = 'linear' | 'outCubic' | 'inQuad' | 'outQuad' | 'overshoot' | 'inOutSin';

interface TimelineKeyframe {
  at: number;
  v: number;
  /** Easing INTO this keyframe from the previous one. Default linear. */
  e?: EasingKey;
}

export type Track = readonly [TimelineKeyframe, ...TimelineKeyframe[]];

export type EasingMap = Record<EasingKey, (x: number) => number>;

/**
 * Sample a track at time `t` (clamped to the first/last keyframe values).
 * Linear scan — tracks are ≤ 16 frames; runs per-frame on the UI thread.
 */
export function valueAt(t: number, track: Track, easings: EasingMap): number {
  'worklet';
  const first = track[0];
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
