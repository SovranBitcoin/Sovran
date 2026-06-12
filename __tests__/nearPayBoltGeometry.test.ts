import {
  BOLT_CANVAS_MARGIN,
  BOLT_CANVAS_SIZE,
  BOLT_FORK_SEGMENTS,
  BOLT_MAIN_SEGMENTS,
  BOLT_VARIANT_COUNT,
  generateSkyBolts,
  generateStrikeVariants,
  hashSeed,
  mulberry32,
  type SkyBoltConfig,
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

  it('pins the rim-bolt output of a known seed (refactor guard)', () => {
    // The displacement core was generalized for sky bolts; rim bolts must be
    // bit-identical to the originally shipped generator. A drift here means
    // the biased code path changed, not just this pin.
    const [first] = generateStrikeVariants('pin-seed');
    expect(first.main[0].x).toBeCloseTo(81.14869542300849, 10);
    expect(first.main[0].y).toBeCloseTo(49.40127902387503, 10);
  });
});

describe('generateSkyBolts', () => {
  const config: SkyBoltConfig = {
    width: 390,
    height: 700,
    targetX: 195,
    targetY: 360,
    targetRadius: 54,
    count: 2,
  };

  it('is deterministic per seed and differs across seeds', () => {
    expect(generateSkyBolts('peer-1', config)).toEqual(generateSkyBolts('peer-1', config));
    expect(JSON.stringify(generateSkyBolts('peer-1', config))).not.toEqual(
      JSON.stringify(generateSkyBolts('peer-2', config))
    );
  });

  it('produces the requested count with 16-segment mains and standard forks', () => {
    const bolts = generateSkyBolts('peer-1', config);
    expect(bolts).toHaveLength(config.count);
    for (const bolt of bolts) {
      expect(bolt.main).toHaveLength(17);
      expect(bolt.fork).toHaveLength(BOLT_FORK_SEGMENTS + 1);
    }
  });

  it('starts on the top field edge and ends on the face-clearance rim', () => {
    for (const bolt of generateSkyBolts('peer-edge', config)) {
      const start = bolt.main[0];
      const end = bolt.main[bolt.main.length - 1];
      expect(start.y).toBeCloseTo(0, 6);
      const endDistance = Math.hypot(end.x - config.targetX, end.y - config.targetY);
      expect(endDistance).toBeCloseTo(config.targetRadius, 6);
    }
  });

  it('approaches from alternating sides so a pair never stacks', () => {
    const [left, right] = generateSkyBolts('peer-sides', config);
    expect(left.main[0].x).toBeLessThanOrEqual(config.targetX);
    expect(right.main[0].x).toBeGreaterThanOrEqual(config.targetX);
  });

  it('keeps every vertex inside the field and clear of the avatar face', () => {
    for (let i = 0; i < 100; i++) {
      for (const bolt of generateSkyBolts(`seed-${i}`, config)) {
        for (const point of [...bolt.main, ...bolt.fork]) {
          expect(point.x).toBeGreaterThanOrEqual(0);
          expect(point.x).toBeLessThanOrEqual(config.width);
          expect(point.y).toBeGreaterThanOrEqual(0);
          expect(point.y).toBeLessThanOrEqual(config.height);
          const distance = Math.hypot(point.x - config.targetX, point.y - config.targetY);
          expect(distance).toBeGreaterThanOrEqual(config.targetRadius - 1e-6);
        }
      }
    }
  });

  it('honors side-boundary exits when the target sits near a field edge', () => {
    const cornered: SkyBoltConfig = { ...config, targetX: 30, targetY: 80 };
    for (const bolt of generateSkyBolts('peer-corner', cornered)) {
      const start = bolt.main[0];
      const onTop = Math.abs(start.y) < 1e-6;
      const onSide = Math.abs(start.x) < 1e-6 || Math.abs(start.x - cornered.width) < 1e-6;
      expect(onTop || onSide).toBe(true);
    }
  });
});
