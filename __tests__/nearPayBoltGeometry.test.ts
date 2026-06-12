import {
  BOLT_CANVAS_MARGIN,
  BOLT_CANVAS_SIZE,
  BOLT_FORK_SEGMENTS,
  BOLT_MAIN_SEGMENTS,
  BOLT_VARIANT_COUNT,
  generateStrikeVariants,
  hashSeed,
  mulberry32,
} from '@/features/nearPay/lib/boltGeometry';

describe('hashSeed / mulberry32', () => {
  it('is deterministic and seed-sensitive', () => {
    expect(hashSeed('peer-a')).toBe(hashSeed('peer-a'));
    expect(hashSeed('peer-a')).not.toBe(hashSeed('peer-b'));

    const a1 = mulberry32(42);
    const a2 = mulberry32(42);
    const b = mulberry32(43);
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const value of seqA1) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('generateStrikeVariants', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(generateStrikeVariants('peer-1')).toEqual(generateStrikeVariants('peer-1'));
    expect(JSON.stringify(generateStrikeVariants('peer-1'))).not.toEqual(
      JSON.stringify(generateStrikeVariants('peer-2'))
    );
  });

  it('produces the expected variant and segment counts', () => {
    const variants = generateStrikeVariants('peer-1');
    expect(variants).toHaveLength(BOLT_VARIANT_COUNT);
    for (const variant of variants) {
      expect(variant.main).toHaveLength(BOLT_MAIN_SEGMENTS + 1);
      expect(variant.fork).toHaveLength(BOLT_FORK_SEGMENTS + 1);
    }
  });

  it('starts every fork on a vertex of its main bolt', () => {
    for (const variant of generateStrikeVariants('peer-3')) {
      const [forkStart] = variant.fork;
      expect(variant.main.some((point) => point.x === forkStart.x && point.y === forkStart.y)).toBe(
        true
      );
    }
  });

  it('keeps every vertex inside the canvas glow margin across many seeds', () => {
    const min = BOLT_CANVAS_MARGIN;
    const max = BOLT_CANVAS_SIZE - BOLT_CANVAS_MARGIN;
    for (let i = 0; i < 200; i++) {
      for (const variant of generateStrikeVariants(`seed-${i}`)) {
        for (const point of [...variant.main, ...variant.fork]) {
          expect(point.x).toBeGreaterThanOrEqual(min);
          expect(point.x).toBeLessThanOrEqual(max);
          expect(point.y).toBeGreaterThanOrEqual(min);
          expect(point.y).toBeLessThanOrEqual(max);
        }
      }
    }
  });
});
