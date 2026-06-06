import { buildDotFieldPathBuckets } from '@/features/nearPay/lib/dotField';

function centersFromBuckets(
  buckets: ReturnType<typeof buildDotFieldPathBuckets>
): { x: number; y: number }[] {
  const centers: { x: number; y: number }[] = [];
  const centerPattern = /M(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g;

  for (const bucket of buckets) {
    for (const match of bucket.d.matchAll(centerPattern)) {
      centers.push({ x: Number(match[1]), y: Number(match[2]) });
    }
  }

  return centers;
}

function dotCount(buckets: ReturnType<typeof buildDotFieldPathBuckets>): number {
  return buckets.reduce((sum, bucket) => sum + (bucket.d.match(/M/g)?.length ?? 0), 0);
}

function distanceFrom(
  point: { x: number; y: number },
  center: { x: number; y: number } | { cx: number; cy: number }
): number {
  const centerX = 'cx' in center ? center.cx : center.x;
  const centerY = 'cy' in center ? center.cy : center.y;
  return Math.hypot(point.x - centerX, point.y - centerY);
}

describe('near pay dot field buckets', () => {
  it('builds stable grouped svg paths for a fixed size', () => {
    const size = { width: 36, height: 36 };
    const first = buildDotFieldPathBuckets(size, 18, 1);
    const second = buildDotFieldPathBuckets(size, 18, 1);

    expect(first).toEqual(second);
    expect(first.every((bucket) => bucket.d.includes('a1,1'))).toBe(true);
    expect(first.map((bucket) => bucket.opacity)).toEqual(
      [...first.map((bucket) => bucket.opacity)].sort((a, b) => a - b)
    );
  });

  it('keeps the same dot density as the view-backed grid', () => {
    const buckets = buildDotFieldPathBuckets({ width: 36, height: 36 }, 18, 1);

    expect(dotCount(buckets)).toBe(16);
  });

  it('returns no buckets for unmeasured fields', () => {
    expect(buildDotFieldPathBuckets({ width: 0, height: 36 }, 18, 1)).toEqual([]);
    expect(buildDotFieldPathBuckets({ width: 36, height: 0 }, 18, 1)).toEqual([]);
  });

  it('keeps avatar exclusion circles clear while preserving dot density', () => {
    const magnet = { id: 'avatar-a', cx: 46, cy: 46, radius: 14 };
    const buckets = buildDotFieldPathBuckets({ width: 72, height: 72 }, 18, 1, [magnet]);
    const centers = centersFromBuckets(buckets);

    expect(dotCount(buckets)).toBe(36);
    expect(
      Math.min(...centers.map((center) => distanceFrom(center, magnet)))
    ).toBeGreaterThanOrEqual(magnet.radius + 1 - 0.01);
  });

  it('pushes nearby dots away from avatar magnets without a physics engine loop', () => {
    const magnet = { id: 'avatar-a', cx: 46, cy: 46, radius: 14, strength: 18 };
    const baselineCenters = centersFromBuckets(
      buildDotFieldPathBuckets({ width: 72, height: 72 }, 18, 1)
    );
    const magnetCenters = centersFromBuckets(
      buildDotFieldPathBuckets({ width: 72, height: 72 }, 18, 1, [magnet])
    );
    const baselineNearest = Math.min(
      ...baselineCenters.map((center) => distanceFrom(center, magnet))
    );
    const magnetNearest = Math.min(...magnetCenters.map((center) => distanceFrom(center, magnet)));

    expect(baselineNearest).toBeLessThan(magnet.radius);
    expect(magnetNearest).toBeGreaterThan(baselineNearest);
    expect(magnetNearest).toBeGreaterThanOrEqual(magnet.radius + 1 - 0.01);
  });

  it('keeps magnetic output deterministic regardless of magnet order', () => {
    const first = buildDotFieldPathBuckets({ width: 90, height: 90 }, 18, 1, [
      { id: 'b', cx: 62, cy: 42, radius: 12 },
      { id: 'a', cx: 28, cy: 48, radius: 12 },
    ]);
    const second = buildDotFieldPathBuckets({ width: 90, height: 90 }, 18, 1, [
      { id: 'a', cx: 28, cy: 48, radius: 12 },
      { id: 'b', cx: 62, cy: 42, radius: 12 },
    ]);

    expect(first).toEqual(second);
  });
});
