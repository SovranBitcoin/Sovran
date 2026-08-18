/**
 * Deterministic lightning-bolt geometry for the NearPay strike effect.
 * Pure module — no skia/react imports — so jest can pin the visuals down:
 * the same seed always yields the same bolts, and every vertex stays inside
 * the canvas with enough margin for the glow blur.
 *
 * Bolts are rim arcs around the avatar (never across the face): endpoints
 * sit on a circle just outside the avatar radius, and midpoint displacement
 * is biased outward so the jagged path bulges away from the portrait.
 */

interface BoltPoint {
  x: number;
  y: number;
}

export interface BoltVariant {
  /** Main bolt polyline (BOLT_MAIN_SEGMENTS segments). */
  main: BoltPoint[];
  /** Short fork branching off the main bolt. */
  fork: BoltPoint[];
}

/** Canvas is square, centered on the avatar. */
export const BOLT_CANVAS_SIZE = 112;
export const BOLT_CANVAS_CENTER = BOLT_CANVAS_SIZE / 2;
/** Bolt endpoints sit on this rim, just outside the 24px avatar radius. */
const BOLT_RIM_RADIUS = 26;
/** Maximum outward bulge of any displaced vertex beyond the rim. */
const BOLT_MAX_BULGE = 16;
/**
 * Every vertex must stay at least this far from the canvas edge so the
 * widest glow stroke (5.5px, blur σ6 ≈ 18px falloff) stays inside.
 */
export const BOLT_CANVAS_MARGIN = 8;
/** Midpoint-displacement iterations: 1 segment → 2^3 = 8 segments. */
const BOLT_DISPLACEMENT_ITERATIONS = 3;
export const BOLT_MAIN_SEGMENTS = 2 ** BOLT_DISPLACEMENT_ITERATIONS;
export const BOLT_FORK_SEGMENTS = 3;
export const BOLT_VARIANT_COUNT = 4;

/** FNV-1a 32-bit string hash — stable across platforms. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — tiny deterministic PRNG over a 32-bit state. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clampToCanvas(point: BoltPoint): BoltPoint {
  const min = BOLT_CANVAS_MARGIN;
  const max = BOLT_CANVAS_SIZE - BOLT_CANVAS_MARGIN;
  return {
    x: Math.min(Math.max(point.x, min), max),
    y: Math.min(Math.max(point.y, min), max),
  };
}

function pointOnRim(angleRad: number, radius: number): BoltPoint {
  return {
    x: BOLT_CANVAS_CENTER + Math.cos(angleRad) * radius,
    y: BOLT_CANVAS_CENTER + Math.sin(angleRad) * radius,
  };
}

interface DisplaceOptions {
  iterations: number;
  /** First-iteration amplitude as a fraction of the chord length. */
  amplitudeFactor: number;
  /**
   * Outward-bias origin: displacement favors the side facing away from this
   * point ([-0.35, 1] of the amplitude). `null` = symmetric displacement
   * ([-1, 1]) for long bolts with no rim to hug.
   */
  biasCenter: BoltPoint | null;
  maxBulge: number;
  clampPoint: (point: BoltPoint) => BoltPoint;
}

/**
 * Midpoint-displacement polyline core. Displacement runs along the segment
 * normal; amplitude halves per iteration. Exactly one `random()` call per
 * midpoint regardless of options, so seeded sequences stay stable.
 */
function displacePolylineWith(
  start: BoltPoint,
  end: BoltPoint,
  random: () => number,
  options: DisplaceOptions
): BoltPoint[] {
  let points: BoltPoint[] = [start, end];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);

  for (let iteration = 0; iteration < options.iterations; iteration++) {
    const amplitude = chord * options.amplitudeFactor * 0.5 ** iteration;
    const next: BoltPoint[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      next.push(a);

      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      // Unit normal to the segment.
      let nx = -dy / length;
      let ny = dx / length;
      let displacement: number;
      if (options.biasCenter) {
        // Bias outward: flip the normal when it points toward the center.
        const outX = midX - options.biasCenter.x;
        const outY = midY - options.biasCenter.y;
        if (nx * outX + ny * outY < 0) {
          nx = -nx;
          ny = -ny;
        }
        // [-0.35, 1] of the amplitude: mostly outward, occasional inward nick
        // for jaggedness, with the bulge hard-capped.
        displacement = Math.min((random() * 1.35 - 0.35) * amplitude, options.maxBulge);
      } else {
        displacement = Math.max(
          -options.maxBulge,
          Math.min((random() * 2 - 1) * amplitude, options.maxBulge)
        );
      }
      next.push(options.clampPoint({ x: midX + nx * displacement, y: midY + ny * displacement }));
    }
    next.push(points[points.length - 1]);
    points = next;
  }

  return points;
}

/**
 * Rim-bolt polyline between two rim points, biased outward (away from the
 * canvas center) so the bolt hugs the rim's outside.
 */
function displacePolyline(start: BoltPoint, end: BoltPoint, random: () => number): BoltPoint[] {
  return displacePolylineWith(start, end, random, {
    iterations: BOLT_DISPLACEMENT_ITERATIONS,
    amplitudeFactor: 0.18,
    biasCenter: { x: BOLT_CANVAS_CENTER, y: BOLT_CANVAS_CENTER },
    maxBulge: BOLT_MAX_BULGE,
    clampPoint: clampToCanvas,
  });
}

function generateFork(main: BoltPoint[], random: () => number): BoltPoint[] {
  // Branch from the vertex nearest t≈0.55 of the main bolt.
  const branchIndex = Math.round((main.length - 1) * 0.55);
  const branchPoint = main[branchIndex];

  // Head 30–45° outward from the branch point, at ~60% of the main reach.
  const outAngle = Math.atan2(
    branchPoint.y - BOLT_CANVAS_CENTER,
    branchPoint.x - BOLT_CANVAS_CENTER
  );
  const side = random() < 0.5 ? -1 : 1;
  const forkAngle = outAngle + side * ((30 + random() * 15) * (Math.PI / 180));
  const reach = (BOLT_MAX_BULGE * 0.6 + random() * 4) * 0.9;

  const fork: BoltPoint[] = [branchPoint];
  let current = branchPoint;
  for (let i = 1; i <= BOLT_FORK_SEGMENTS; i++) {
    const t = i / BOLT_FORK_SEGMENTS;
    const jitter = (random() - 0.5) * 4;
    current = clampToCanvas({
      x: branchPoint.x + Math.cos(forkAngle) * reach * t + jitter,
      y: branchPoint.y + Math.sin(forkAngle) * reach * t + jitter,
    });
    fork.push(current);
  }
  return fork;
}

/**
 * Generate the strike's bolt variants for a seed string (the peer ID). Each
 * variant arcs over a different quadrant of the rim so desynchronized
 * flickers light different parts of the avatar's halo.
 */
export function generateStrikeVariants(seedString: string): BoltVariant[] {
  const variants: BoltVariant[] = [];
  for (let i = 0; i < BOLT_VARIANT_COUNT; i++) {
    const random = mulberry32(hashSeed(`${seedString}:${i}`));
    const baseAngle = (i * 90 + random() * 30 - 15) * (Math.PI / 180);
    const sweep = (55 + random() * 30) * (Math.PI / 180);
    const start = pointOnRim(baseAngle, BOLT_RIM_RADIUS);
    const end = pointOnRim(baseAngle + sweep, BOLT_RIM_RADIUS);
    const main = displacePolyline(start, end, random);
    variants.push({ main, fork: generateFork(main, random) });
  }
  return variants;
}

// ---------------------------------------------------------------------------
// Sky bolts — full-field strikes for the Nut Drop receive celebration.

export interface SkyBoltConfig {
  /** Field (celebration canvas) size in px. */
  width: number;
  height: number;
  /** Strike target — the centered celebration avatar's center. */
  targetX: number;
  targetY: number;
  /**
   * Bolts terminate on this radius around the target and no vertex ever
   * enters it — the geometry-level face-protection twin of the canvas's
   * inverted clip.
   */
  targetRadius: number;
  count: number;
}

/** Long bolts need a finer fractal: 2^4 = 16 segments. */
const SKY_BOLT_DISPLACEMENT_ITERATIONS = 4;
/** Approach corridor around straight-down: ±35° from vertical. */
const SKY_BOLT_MAX_TILT_RAD = (35 * Math.PI) / 180;

/** Keep vertices inside the field and outside the avatar face circle. */
function clampSkyPoint(config: SkyBoltConfig, point: BoltPoint): BoltPoint {
  let x = Math.min(Math.max(point.x, 0), config.width);
  let y = Math.min(Math.max(point.y, 0), config.height);
  const dx = x - config.targetX;
  const dy = y - config.targetY;
  const distance = Math.hypot(dx, dy);
  if (distance < config.targetRadius) {
    if (distance === 0) {
      y = config.targetY - config.targetRadius;
    } else {
      x = config.targetX + (dx / distance) * config.targetRadius;
      y = config.targetY + (dy / distance) * config.targetRadius;
    }
  }
  return { x, y };
}

function generateSkyFork(
  main: BoltPoint[],
  random: () => number,
  chord: number,
  clampPoint: (point: BoltPoint) => BoltPoint
): BoltPoint[] {
  // Branch from a vertex in the bolt's middle stretch (t ≈ 0.4–0.65).
  const branchIndex = Math.round((main.length - 1) * (0.4 + random() * 0.25));
  const branchPoint = main[branchIndex];
  const nextPoint = main[Math.min(branchIndex + 1, main.length - 1)];
  const travelAngle = Math.atan2(nextPoint.y - branchPoint.y, nextPoint.x - branchPoint.x);
  const side = random() < 0.5 ? -1 : 1;
  const forkAngle = travelAngle + side * ((25 + random() * 25) * (Math.PI / 180));
  const reach = chord * (0.12 + random() * 0.08);

  const fork: BoltPoint[] = [branchPoint];
  for (let i = 1; i <= BOLT_FORK_SEGMENTS; i++) {
    const t = i / BOLT_FORK_SEGMENTS;
    const jitter = (random() - 0.5) * reach * 0.3;
    fork.push(
      clampPoint({
        x: branchPoint.x + Math.cos(forkAngle) * reach * t + jitter,
        y: branchPoint.y + Math.sin(forkAngle) * reach * t + jitter,
      })
    );
  }
  return fork;
}

/**
 * Full-field celebration bolts: each starts where its approach ray exits the
 * field (top edge for a centered target) and ends on the face-clearance rim
 * around the target. Deterministic per seed; bolt `i` approaches from the
 * left/right alternately so a pair never lands on the same side.
 */
export function generateSkyBolts(seedString: string, config: SkyBoltConfig): BoltVariant[] {
  const bolts: BoltVariant[] = [];
  const clampPoint = (point: BoltPoint) => clampSkyPoint(config, point);

  for (let i = 0; i < config.count; i++) {
    const random = mulberry32(hashSeed(`${seedString}:sky:${i}`));
    const side = i % 2 === 0 ? -1 : 1;
    const angle = -Math.PI / 2 + side * random() * SKY_BOLT_MAX_TILT_RAD;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);

    // Distance along the ray to the first field boundary (top, or a side
    // when the target sits near an edge). dirY < 0 always (±35° corridor).
    let exitT = -config.targetY / dirY;
    if (dirX > 1e-9) exitT = Math.min(exitT, (config.width - config.targetX) / dirX);
    if (dirX < -1e-9) exitT = Math.min(exitT, -config.targetX / dirX);

    const start = {
      x: config.targetX + dirX * exitT,
      y: config.targetY + dirY * exitT,
    };
    const end = {
      x: config.targetX + dirX * config.targetRadius,
      y: config.targetY + dirY * config.targetRadius,
    };
    const chord = Math.max(exitT - config.targetRadius, 1);

    const main = displacePolylineWith(start, end, random, {
      iterations: SKY_BOLT_DISPLACEMENT_ITERATIONS,
      // Long bolts need proportionally less wiggle than rim arcs.
      amplitudeFactor: 0.1,
      biasCenter: null,
      maxBulge: chord * 0.12,
      clampPoint,
    });
    bolts.push({ main, fork: generateSkyFork(main, random, chord, clampPoint) });
  }
  return bolts;
}
