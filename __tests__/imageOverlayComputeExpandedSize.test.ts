import { computeExpandedSize } from '@/features/feed/components/nostr/image-overlay/provider';

describe('computeExpandedSize (audit 58.json F-006)', () => {
  it('fits by width when aspectRatio yields a wide image', () => {
    const r = computeExpandedSize(400, 800, 1);
    expect(r).toEqual({ width: 400, height: 400 });
  });

  it('fits by height when aspectRatio is too tall to fit by width', () => {
    const r = computeExpandedSize(400, 200, 1);
    expect(r).toEqual({ width: 200, height: 200 });
  });

  it('preserves aspect ratio for landscape images', () => {
    const r = computeExpandedSize(400, 800, 2);
    expect(r.width / r.height).toBeCloseTo(2);
  });

  it('falls back to a square in the screen rect when aspectRatio is 0', () => {
    const r = computeExpandedSize(400, 800, 0);
    expect(r).toEqual({ width: 400, height: 400 });
    expect(Number.isFinite(r.width)).toBe(true);
    expect(Number.isFinite(r.height)).toBe(true);
  });

  it('falls back when aspectRatio is negative (relay-supplied garbage)', () => {
    const r = computeExpandedSize(400, 800, -3);
    expect(r).toEqual({ width: 400, height: 400 });
  });

  it('falls back when aspectRatio is NaN', () => {
    const r = computeExpandedSize(400, 800, Number.NaN);
    expect(r).toEqual({ width: 400, height: 400 });
    expect(Number.isNaN(r.width)).toBe(false);
    expect(Number.isNaN(r.height)).toBe(false);
  });

  it('falls back when aspectRatio is Infinity', () => {
    const r = computeExpandedSize(400, 800, Number.POSITIVE_INFINITY);
    expect(r).toEqual({ width: 400, height: 400 });
    expect(Number.isFinite(r.width)).toBe(true);
    expect(Number.isFinite(r.height)).toBe(true);
  });
});
