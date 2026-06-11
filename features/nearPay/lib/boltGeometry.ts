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

export interface BoltPoint {
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

/**
 * Midpoint-displacement polyline between two rim points. Displacement runs
 * along the segment normal, biased outward (away from the canvas center) so
 * the bolt hugs the rim's outside; amplitude halves per iteration.
 */
function displacePolyline(start: BoltPoint, end: BoltPoint, random: () => number): BoltPoint[] {
  let points: BoltPoint[] = [start, end];
  const chord = Math.hypot(end.x - start.x, end.y - start.y);

  for (let iteration = 0; iteration < BOLT_DISPLACEMENT_ITERATIONS; iteration++) {
    const amplitude = chord * 0.18 * 0.5 ** iteration;
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
      // Bias outward: flip the normal when it points toward the center.
      const outX = midX - BOLT_CANVAS_CENTER;
      const outY = midY - BOLT_CANVAS_CENTER;
      if (nx * outX + ny * outY < 0) {
        nx = -nx;
        ny = -ny;
      }
      // [-0.35, 1] of the amplitude: mostly outward, occasional inward nick
      // for jaggedness, with the bulge hard-capped.
      const displacement = Math.min((random() * 1.35 - 0.35) * amplitude, BOLT_MAX_BULGE);
      next.push(clampToCanvas({ x: midX + nx * displacement, y: midY + ny * displacement }));
    }
    next.push(points[points.length - 1]);
    points = next;
  }

  return points;
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
