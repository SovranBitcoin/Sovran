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
 *   The audit pill is the exception: the base row's audit is a snapshot of this
 *   same cache, so the cache's `selectMintAudit` reading always wins and the
 *   three audit fields move together. The mint info page reads that selector
 *   too, so a row and the page it opens never disagree.
 */
import { useMemo } from 'react';

import { toAccountUnit, type MintListItem } from 'wallet';

import { selectMintAudit } from '@/features/mint/lib/auditInfo';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { useIsTestnutMint } from '@/shared/stores/global/mintTestnutStore';
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
  /** The testnut verdict, for tagging cached units onto their account. */
  isTestnutMint: (mintUrl: string) => boolean;
}

/**
 * Pure merge — overlays the cache snapshot onto the base rows. Exported and
 * tested directly (the hook is a thin reactive wrapper), mirroring the
 * `resolveStickyMintSelectorItems` convention.
 */
export function resolveMintRows({
  baseItems,
  itemsStatus,
  byMintUrl,
  isTestnutMint,
}: ResolveMintRowsArgs): {
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
  const pickUnits = (b: string[] | undefined, c: string[] | undefined) =>
    ready ? (b ?? c) : (c ?? b);

  const rows = baseItems.map((base): MintRow => {
    const cache = byMintUrl[normalizeMintUrlKey(base.mintUrl)];
    const metaState: MintRowMetaState = ready ? 'live' : cache ? 'cached' : 'cold';
    if (!cache) return { ...base, metaState };

    const cacheReputation =
      typeof cache.contactReputation === 'number' ? Math.round(cache.contactReputation) : undefined;
    const audit = selectMintAudit(cache);
    // The currency tabs and their filter read `supportedUnits`, and colada's
    // synchronous fallback rows carry none — so before enrichment every row
    // passed every tab, and the list visibly dropped rows once the real units
    // landed. The cache already knows them; it stores the mint's REAL units, so
    // they are tagged onto their account here exactly as `buildMintListItems`
    // does (a testnut mint's `sat` is `tsat`).
    const cachedUnits = cache.supportedUnits?.length
      ? cache.supportedUnits.map((unit) => toAccountUnit(unit, isTestnutMint(base.mintUrl)))
      : undefined;

    return {
      ...base,
      // identity (cache wins pre-enrichment so the url/bank-icon never shows).
      // The `?? base.displayName` pins the result to the required `string` type
      // (pickStr is `string | undefined`); it's type-load-bearing, not redundant.
      displayName: pickStr(base.displayName, cache.displayName) ?? base.displayName,
      iconUrl: pickStr(base.iconUrl, cache.iconUrl),
      // Enrichment owns the units once it lands (it reads the mint's real
      // keysets, which the cache does not); before that the cache fills the
      // hole. Left absent when neither knows them, which the tab filter reads
      // as "unknown" and shows the row under every tab.
      ...(pickUnits(base.supportedUnits, cachedUnits)
        ? { supportedUnits: pickUnits(base.supportedUnits, cachedUnits) }
        : {}),
      // review + audit + social metadata (animate targets)
      kymScore: pickNum(base.kymScore, cache.averageScore ?? undefined),
      reviewCount: pickNum(base.reviewCount, cache.reviewCount),
      ...(audit
        ? { auditScore: audit.score, auditState: audit.state, auditTotalOps: audit.totalOps }
        : {}),
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
}: Omit<ResolveMintRowsArgs, 'byMintUrl' | 'isTestnutMint'>): {
  rows: MintRow[];
  allCold: boolean;
} {
  // Subscribe to the cache map so a background refresh or bulk discover upsert
  // re-runs the merge and promotes cached values to fresh ones.
  const byMintUrl = useMintMetadataStore((s) => s.byMintUrl);
  const isTestnutMint = useIsTestnutMint();
  return useMemo(
    () => resolveMintRows({ baseItems, itemsStatus, byMintUrl, isTestnutMint }),
    [baseItems, itemsStatus, byMintUrl, isTestnutMint]
  );
}
