import type { PeerLayoutSize } from './peerLayout';

interface DotFieldPathBucket {
  key: string;
  opacity: number;
  d: string;
}

interface DotFieldMagnet {
  id: string;
  cx: number;
  cy: number;
  radius: number;
  influenceRadius?: number;
  strength?: number;
}

const DOT_OPACITY_BUCKETS = [0.06, 0.0725, 0.085, 0.0975, 0.11] as const;
const DEFAULT_MAGNET_INFLUENCE_SPACING = 2.35;
const DEFAULT_MAGNET_STRENGTH_SPACING = 0.78;
const DOT_RELAXATION_ITERATIONS = 2;
const DOT_RELAXATION_MIN_SPACING = 0.52;
const DOT_RELAXATION_STRENGTH = 0.5;
const EPSILON = 0.0001;

interface DotPoint {
  x: number;
  y: number;
  bucketIndex: number;
  seed: string;
}

function seededUnit(seed: string, salt: number): number {
  let hash = 2166136261 + salt;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function circlePath(cx: number, cy: number, radius: number): string {
  const diameter = radius * 2;
  return `M${cx},${cy}m-${radius},0a${radius},${radius} 0 1,0 ${diameter},0a${radius},${radius} 0 1,0 -${diameter},0`;
}

export function buildDotFieldPathBuckets(
  size: PeerLayoutSize,
  spacing: number,
  radius = 1,
  magnets: readonly DotFieldMagnet[] = []
): DotFieldPathBucket[] {
  if (size.width <= 0 || size.height <= 0 || spacing <= 0 || radius <= 0) return [];
  const cols = Math.ceil(size.width / spacing) + 2;
  const rows = Math.ceil(size.height / spacing) + 2;
  const normalizedMagnets = normalizeMagnets(magnets);
  const points: DotPoint[] = [];
  const paths = DOT_OPACITY_BUCKETS.map(() => [] as string[]);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const seed = seededUnit(`${x}:${y}`, 31);
      const bucketIndex = Math.min(
        DOT_OPACITY_BUCKETS.length - 1,
        Math.floor(seed * DOT_OPACITY_BUCKETS.length)
      );
      const left = x * spacing - spacing / 2;
      const top = y * spacing - spacing / 2;
      points.push({
        x: left + radius,
        y: top + radius,
        bucketIndex,
        seed: `${x}:${y}`,
      });
    }
  }

  if (normalizedMagnets.length > 0) {
    for (const point of points) {
      for (const magnet of normalizedMagnets) {
        repelFromMagnet(point, magnet, spacing, radius);
      }
    }
    relaxDots(points, spacing);
    for (const point of points) {
      for (const magnet of normalizedMagnets) {
        enforceMagnetExclusion(point, magnet, radius);
      }
    }
  }

  for (const point of points) {
    paths[point.bucketIndex].push(
      circlePath(roundPathNumber(point.x), roundPathNumber(point.y), radius)
    );
  }

  return paths
    .map((segments, index) => ({
      key: `dot-bucket-${index}`,
      opacity: DOT_OPACITY_BUCKETS[index],
      d: segments.join(''),
    }))
    .filter((bucket) => bucket.d.length > 0);
}

function normalizeMagnets(magnets: readonly DotFieldMagnet[]): DotFieldMagnet[] {
  return magnets
    .filter(
      (magnet) =>
        Number.isFinite(magnet.cx) &&
        Number.isFinite(magnet.cy) &&
        Number.isFinite(magnet.radius) &&
        magnet.radius > 0
    )
    .map((magnet) => ({ ...magnet }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function repelFromMagnet(
  point: DotPoint,
  magnet: DotFieldMagnet,
  spacing: number,
  dotRadius: number
): void {
  const exclusionRadius = magnet.radius + dotRadius;
  const influenceRadius = Math.max(
    magnet.influenceRadius ?? exclusionRadius + spacing * DEFAULT_MAGNET_INFLUENCE_SPACING,
    exclusionRadius + dotRadius
  );
  const dx = point.x - magnet.cx;
  const dy = point.y - magnet.cy;
  const distance = Math.hypot(dx, dy);
  if (distance >= influenceRadius) return;

  const direction =
    distance > EPSILON
      ? { x: dx / distance, y: dy / distance }
      : seededDirection(`${point.seed}:${magnet.id}`);
  const strength = magnet.strength ?? spacing * DEFAULT_MAGNET_STRENGTH_SPACING;
  const distanceProgress = Math.max(0, distance - exclusionRadius);
  const influenceSpan = Math.max(EPSILON, influenceRadius - exclusionRadius);
  const falloff = Math.max(0, 1 - distanceProgress / influenceSpan);
  const nextDistance =
    distance < exclusionRadius
      ? exclusionRadius
      : Math.min(influenceRadius, distance + falloff * falloff * strength);

  point.x = magnet.cx + direction.x * nextDistance;
  point.y = magnet.cy + direction.y * nextDistance;
}

function relaxDots(points: DotPoint[], spacing: number): void {
  const minDistance = spacing * DOT_RELAXATION_MIN_SPACING;
  for (let iteration = 0; iteration < DOT_RELAXATION_ITERATIONS; iteration++) {
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const a = points[i];
        const b = points[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minDistance) continue;

        const direction =
          distance > EPSILON
            ? { x: dx / distance, y: dy / distance }
            : seededDirection(`${a.seed}:${b.seed}:relax`);
        const push = ((minDistance - distance) / 2) * DOT_RELAXATION_STRENGTH;
        a.x -= direction.x * push;
        a.y -= direction.y * push;
        b.x += direction.x * push;
        b.y += direction.y * push;
      }
    }
  }
}

function enforceMagnetExclusion(point: DotPoint, magnet: DotFieldMagnet, dotRadius: number): void {
  const exclusionRadius = magnet.radius + dotRadius;
  const dx = point.x - magnet.cx;
  const dy = point.y - magnet.cy;
  const distance = Math.hypot(dx, dy);
  if (distance >= exclusionRadius) return;

  const direction =
    distance > EPSILON
      ? { x: dx / distance, y: dy / distance }
      : seededDirection(`${point.seed}:${magnet.id}:enforce`);
  point.x = magnet.cx + direction.x * exclusionRadius;
  point.y = magnet.cy + direction.y * exclusionRadius;
}

function seededDirection(seed: string): { x: number; y: number } {
  const angle = seededUnit(seed, 97) * Math.PI * 2;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function roundPathNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}
