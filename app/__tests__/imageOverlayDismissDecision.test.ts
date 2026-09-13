import { computeDismissDecision } from '@/features/feed/components/nostr/image-overlay/dismissDecision';
import {
  DISMISS_FLICK_MIN_DISTANCE,
  DISMISS_FLICK_VELOCITY_PX_S,
  DISMISS_VELOCITY_WEIGHT_S,
} from '@/features/feed/components/nostr/image-overlay/config';

describe('computeDismissDecision', () => {
  it.each([
    { name: 'slow long drag past threshold', dx: 0, dy: 201, vx: 0, vy: 10, expected: 'dismiss' },
    { name: 'fast short flick outward', dx: 0, dy: 20, vx: 0, vy: 1200, expected: 'dismiss' },
    {
      name: 'fast flick back toward origin',
      dx: 0,
      dy: 150,
      vx: 0,
      vy: -2000,
      expected: 'restore',
    },
    {
      name: 'exact threshold with zero velocity',
      dx: 0,
      dy: 200,
      vx: 0,
      vy: 0,
      expected: 'restore',
    },
    {
      name: 'fast flick below minimum distance',
      dx: 0,
      dy: 11,
      vx: 0,
      vy: 1200,
      expected: 'restore',
    },
    {
      name: 'zero displacement with fast velocity',
      dx: 0,
      dy: 0,
      vx: 2000,
      vy: 2000,
      expected: 'restore',
    },
    {
      name: 'perpendicular velocity adds no outward travel',
      dx: 150,
      dy: 0,
      vx: 0,
      vy: 2000,
      expected: 'restore',
    },
    { name: 'diagonal outward flick', dx: -12, dy: -16, vx: -720, vy: -960, expected: 'dismiss' },
    {
      name: 'projection past threshold below flick speed',
      dx: 0,
      dy: 100,
      vx: 0,
      vy: 1000,
      expected: 'dismiss',
    },
    {
      name: 'exact flick speed without sufficient projection',
      dx: 0,
      dy: 20,
      vx: 0,
      vy: 1100,
      expected: 'restore',
    },
    { name: 'exact minimum flick distance', dx: 0, dy: 12, vx: 0, vy: 1200, expected: 'restore' },
    {
      name: 'projection can exceed threshold below minimum distance',
      dx: 0,
      dy: 11,
      vx: 0,
      vy: 2000,
      expected: 'dismiss',
    },
  ])('$name → $expected', ({ dx, dy, vx, vy, expected }) => {
    expect(
      computeDismissDecision({
        dx,
        dy,
        vx,
        vy,
        threshold: 200,
        minFlickDistance: DISMISS_FLICK_MIN_DISTANCE,
        velocityWeightS: DISMISS_VELOCITY_WEIGHT_S,
        flickVelocityPxS: DISMISS_FLICK_VELOCITY_PX_S,
      })
    ).toBe(expected);
  });
});
