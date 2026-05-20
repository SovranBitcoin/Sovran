import type { PeerLayoutSize } from './peerLayout';

interface DotFieldPathBucket {
  key: string;
  opacity: number;
  d: string;
}

const DOT_OPACITY_BUCKETS = [0.06, 0.0725, 0.085, 0.0975, 0.11] as const;

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
  radius = 1
): DotFieldPathBucket[] {
  if (size.width <= 0 || size.height <= 0 || spacing <= 0 || radius <= 0) return [];
  const cols = Math.ceil(size.width / spacing) + 2;
  const rows = Math.ceil(size.height / spacing) + 2;
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
      paths[bucketIndex].push(circlePath(left + radius, top + radius, radius));
    }
  }

  return paths
    .map((segments, index) => ({
      key: `dot-bucket-${index}`,
      opacity: DOT_OPACITY_BUCKETS[index],
      d: segments.join(''),
    }))
    .filter((bucket) => bucket.d.length > 0);
}
