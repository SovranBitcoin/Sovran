import { computeMarqueeAnimation } from '@/shared/lib/marquee';

it.each([0, 99, 100])('does not animate text that fits (%s px)', (textWidth) => {
  expect(computeMarqueeAnimation({ textWidth, containerWidth: 100 })).toEqual({
    overflowing: false,
    distancePx: 0,
    durationMs: 0,
  });
});

it('waits for the container measurement', () => {
  expect(computeMarqueeAnimation({ textWidth: 200, containerWidth: 0 }).overflowing).toBe(false);
});

it('moves through the entire text and gap at the default speed', () => {
  expect(computeMarqueeAnimation({ textWidth: 252, containerWidth: 100 })).toEqual({
    overflowing: true,
    distancePx: 300,
    durationMs: 10000,
  });
});

it('uses the supplied speed and gap', () => {
  expect(
    computeMarqueeAnimation({
      textWidth: 200,
      containerWidth: 100,
      speedPxPerSecond: 50,
      gapPx: 25,
    })
  ).toEqual({ overflowing: true, distancePx: 225, durationMs: 4500 });
});

it('avoids infinite durations and overlapping copies for nonpositive input', () => {
  expect(
    computeMarqueeAnimation({
      textWidth: 150,
      containerWidth: 100,
      speedPxPerSecond: 0,
      gapPx: -1,
    })
  ).toEqual({ overflowing: true, distancePx: 150, durationMs: 5000 });
});
