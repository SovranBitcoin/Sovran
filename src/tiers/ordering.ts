import type { OrderingManifest } from '@sovranbitcoin/schemas';

// ---------------------------------------------------------------------------
// Ordering-manifest applier
//
// The structural anti-reshuffle guarantee. A tier returns its bundle UNORDERED
// (keyed by id) plus a server-authoritative ordered id list. The client renders
// strictly by the manifest, index by index — so out-of-order tier delivery,
// late enrichment, or a re-fetch can never reshuffle what the user is looking at.
//
// Two deliberate rules:
//   - An id in the manifest but ABSENT from the bundle is skipped (we were told
//     to render it but didn't receive it — e.g. a dropped enrichment). Recorded
//     via `onMissing` so the caller can lazily backfill, never rendered as a gap.
//   - A bundle entry NOT in the manifest is NOT rendered. The server chose the
//     page's membership and order; extra events we happened to receive are not
//     silently appended (that would itself be a reshuffle vector).
// ---------------------------------------------------------------------------

export type ApplyOrderingOptions = {
  /** Called for each manifest id missing from the bundle (for lazy backfill / telemetry). */
  onMissing?: (id: string) => void;
};

export function applyOrderingManifest<T>(
  manifest: OrderingManifest,
  bundle: Map<string, T> | Record<string, T>,
  options: ApplyOrderingOptions = {},
): T[] {
  const lookup = bundle instanceof Map ? bundle : new Map(Object.entries(bundle));
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const id of manifest.elements) {
    // Defend against a duplicate id in the manifest — render each at most once.
    if (seen.has(id)) continue;
    seen.add(id);

    const item = lookup.get(id);
    if (item === undefined) {
      options.onMissing?.(id);
      continue;
    }
    ordered.push(item);
  }

  return ordered;
}

/**
 * Synthesize a `created_at`-descending manifest for a tier that cannot produce a
 * ranked one (the raw-relay floor). Keeps the same contract — the caller still
 * renders strictly by a manifest — so anti-reshuffle holds even on the floor.
 * Ties on `created_at` break by id (lexicographic, descending) for stability.
 */
export function synthesizeRecencyManifest(
  events: ReadonlyArray<{ id: string; created_at: number }>,
): OrderingManifest {
  const elements = [...events]
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((e) => e.id);
  return { orderBy: 'created_at', elements };
}
