/**
 * Groups items by a string key, preserving input order within each group.
 */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = Object.create(null);
  for (const item of items) {
    (out[key(item)] ??= []).push(item);
  }
  return out;
}
