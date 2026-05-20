import { buildDotFieldPathBuckets } from '@/features/nearPay/lib/dotField';

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
    const dotCount = buckets.reduce((sum, bucket) => sum + (bucket.d.match(/M/g)?.length ?? 0), 0);

    expect(dotCount).toBe(16);
  });

  it('returns no buckets for unmeasured fields', () => {
    expect(buildDotFieldPathBuckets({ width: 0, height: 36 }, 18, 1)).toEqual([]);
    expect(buildDotFieldPathBuckets({ width: 36, height: 0 }, 18, 1)).toEqual([]);
  });
});
