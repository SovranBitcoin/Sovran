/**
 * Pins the gesture-demo timeline invariants that are otherwise only
 * verifiable by staring at a device for minutes: every track is monotonic in
 * time and SEAMLESS across the loop boundary (value at 0 === value at
 * CYCLE_MS), and the keyframe evaluator clamps/interpolates correctly.
 * Pure module — no reanimated import or mock needed.
 */

import {
  CYCLE_MS,
  DEMO_TRACKS,
  valueAt,
  type EasingMap,
  type Track,
} from '@/features/nostrSigner/components/permissionGestureDemo.timeline';

const identity = (x: number): number => x;
const IDENTITY_EASINGS: EasingMap = {
  linear: identity,
  outCubic: identity,
  inQuad: identity,
  outQuad: identity,
  overshoot: identity,
  inOutSin: identity,
};

const TRACK_ENTRIES = Object.entries(DEMO_TRACKS) as [string, Track][];

describe('demo timeline tracks', () => {
  it.each(TRACK_ENTRIES)(
    '%s has strictly increasing keyframes within the cycle',
    (_name, track) => {
      expect(track.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < track.length; i += 1) {
        const frame = track[i]!;
        expect(frame.at).toBeGreaterThanOrEqual(0);
        expect(frame.at).toBeLessThanOrEqual(CYCLE_MS);
        if (i > 0) expect(frame.at).toBeGreaterThan(track[i - 1]!.at);
      }
    }
  );

  it.each(TRACK_ENTRIES)(
    '%s loops seamlessly (value at 0 === value at CYCLE_MS)',
    (_name, track) => {
      expect(valueAt(CYCLE_MS, track, IDENTITY_EASINGS)).toBe(valueAt(0, track, IDENTITY_EASINGS));
    }
  );
});

describe('valueAt', () => {
  const track: Track = [
    { at: 100, v: 10 },
    { at: 200, v: 30 },
    { at: 400, v: 30 },
  ];

  it('clamps before the first and after the last keyframe', () => {
    expect(valueAt(-50, track, IDENTITY_EASINGS)).toBe(10);
    expect(valueAt(0, track, IDENTITY_EASINGS)).toBe(10);
    expect(valueAt(1000, track, IDENTITY_EASINGS)).toBe(30);
  });

  it('returns exact values at keyframes and interpolates between them', () => {
    expect(valueAt(100, track, IDENTITY_EASINGS)).toBe(10);
    expect(valueAt(200, track, IDENTITY_EASINGS)).toBe(30);
    expect(valueAt(150, track, IDENTITY_EASINGS)).toBe(20);
    expect(valueAt(300, track, IDENTITY_EASINGS)).toBe(30);
  });

  it('applies the easing into the destination keyframe', () => {
    const square: EasingMap = { ...IDENTITY_EASINGS, inQuad: (x) => x * x };
    const eased: Track = [
      { at: 0, v: 0 },
      { at: 100, v: 100, e: 'inQuad' },
    ];
    expect(valueAt(50, eased, square)).toBe(25);
  });
});
