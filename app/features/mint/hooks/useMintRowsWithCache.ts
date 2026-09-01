/**
 * Overlay the unified `mintMetadataStore` onto the selector's base rows so the
 * list paints a mint's name / icon / scores on the FIRST frame from cache —
 * without waiting for colada's `selectMint` enrichment (`mintListItemsStatus`).
 *
 * Each row is tagged `metaState`:
 *   - `live`   — colada finished enriching (`itemsStatus === 'ready'`): trust the
 *                base row's fields, cache only backfills holes.
 *   - `cached` — not yet enriched but we have a cache entry: paint cached values.
 *   - `cold`   — no cache and not enriched: the caller renders a skeleton row
 *                (never the raw url + fallback bank icon).
 *
 * Merge precedence (see the plan's per-field table):
 *   identity/availability fields (mintUrl, balance, unit, status, reason,
 *   isPreferred, unreachable, worksOffline) are BASE-OWNED — cache never paints
 *   funds or flow-availability. Metadata fields are `live ?? cache` when enriched
 *   and `cache ?? base` before, so a `cached` row shows the cached name instead
 *   of the url fallback, and once live data lands it wins (and the pill animates).
 */
import { useMemo } from 'react';

import type { MintListItem } from 'wallet';

import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';

type MintRowMetaState = 'cold' | 'cached' | 'live';

export interface MintRow extends MintListItem {
  metaState: MintRowMetaState;
}

interface ResolveMintRowsArgs {
  /** Sticky-resolved colada rows (entry→live), already balance/availability annotated. */
  baseItems: MintListItem[];
  /** List-global enrichment status from the colada selectMint step. */
  itemsStatus: 'loading' | 'ready' | 'failed' | undefined;
  /** Snapshot of the unified cache keyed by normalized mint URL. */
  byMintUrl: Record<string, MintMetadataEntry>;
}

/**
 * Pure merge — overlays the cache snapshot onto the base rows. Exported and
 * tested directly (the hook is a thin reactive wrapper), mirroring the
 * `resolveStickyMintSelectorItems` convention.
 */
export function resolveMintRows({ baseItems, itemsStatus, byMintUrl }: ResolveMintRowsArgs): {
  rows: MintRow[];
  allCold: boolean;
} {
  // `failed` is terminal too: colada is done (offline / enrichment error), so
  // trust the base rows and let them render real + selectable rather than
  // leaving them stuck `cold` (an endless skeleton the user can't pick from).
  const ready = itemsStatus === 'ready' || itemsStatus === 'failed';
  // When enriched, the base row's live value wins and cache only fills holes;
  // before enrichment the cache wins over the base url/fallback placeholders.
  const pickStr = (b: string | undefined, c: string | undefined) => (ready ? (b ?? c) : (c ?? b));
  const pickNum = (b: number | undefined, c: number | undefined) => (ready ? (b ?? c) : (c ?? b));

  const rows = baseItems.map((base): MintRow => {
    const cache = byMintUrl[normalizeMintUrlKey(base.mintUrl)];
    const metaState: MintRowMetaState = ready ? 'live' : cache ? 'cached' : 'cold';
    if (!cache) return { ...base, metaState };

    const cacheReputation =
      typeof cache.contactReputation === 'number' ? Math.round(cache.contactReputation) : undefined;
    const cacheAuditOps =
      cache.nMints != null && cache.nMelts != null ? cache.nMints + cache.nMelts : undefined;

    return {
      ...base,
      // identity (cache wins pre-enrichment so the url/bank-icon never shows).
      // The `?? base.displayName` pins the result to the required `string` type
      // (pickStr is `string | undefined`); it's type-load-bearing, not redundant.
      displayName: pickStr(base.displayName, cache.displayName) ?? base.displayName,
      iconUrl: pickStr(base.iconUrl, cache.iconUrl),
      // review + audit + social metadata (animate targets)
      kymScore: pickNum(base.kymScore, cache.averageScore ?? undefined),
      reviewCount: pickNum(base.reviewCount, cache.reviewCount),
      auditScore: pickNum(base.auditScore, cache.auditScore ?? undefined),
      auditState: pickStr(base.auditState, cache.auditState),
      auditTotalOps: pickNum(base.auditTotalOps, cacheAuditOps),
      contactFollowers: pickNum(base.contactFollowers, cache.contactFollowers),
      contactReputation: pickNum(base.contactReputation, cacheReputation),
      metaState,
    };
  });

  const allCold = rows.length > 0 && rows.every((r) => r.metaState === 'cold');
  return { rows, allCold };
}

export function useMintRowsWithCache({
  baseItems,
  itemsStatus,
}: Omit<ResolveMintRowsArgs, 'byMintUrl'>): { rows: MintRow[]; allCold: boolean } {
  // Subscribe to the cache map so a background refresh or bulk discover upsert
  // re-runs the merge and promotes cached values to fresh ones.
  const byMintUrl = useMintMetadataStore((s) => s.byMintUrl);
  return useMemo(
    () => resolveMintRows({ baseItems, itemsStatus, byMintUrl }),
    [baseItems, itemsStatus, byMintUrl]
  );
}
