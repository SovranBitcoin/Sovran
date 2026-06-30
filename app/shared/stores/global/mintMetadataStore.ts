/**
 * Unified per-mint metadata cache — the single owner of every cacheable mint
 * presentation field (identity / reviews-aggregate / audit / social).
 *
 * Consolidates four previously-separate stores (`mintInfoCache`,
 * `auditMintStore`, `mintProfileStore`, `kymMintStore`) that each cached a
 * slice of the same mint and were wired as independent colada injection
 * points. They are merged here, keyed by normalized mint URL, with a
 * **per-source timestamp** so each group keeps its own SWR cadence:
 *
 *   identity 24h · reviews 60m · audit 60m · social 30m
 *
 * Discipline (keeps this on the right side of `sovran-data/caching.md`, which
 * warns against a scattered "enrichment bag"): this is a single-writer
 * per-source FETCH cache. The only writers are `getCachedMintInfo`,
 * `getMintCatalog`, the discover seed (`upsertFromDiscover`) and the manager
 * attach below — screens read, they do not write ad-hoc derived fields.
 *
 * Raw `info` (NUT-06) and `auditData` blobs are retained verbatim because the
 * mint-info screen derives swap success-rate / latency from `auditData.swaps`
 * and operator-pubkey extraction needs the full NUT-06 contact array. "Cache
 * the aggregate, not the rows" applies strictly to KYM review rows, which are
 * never persisted here — only their `averageScore` / `reviewCount`.
 *
 * Host-scoped (same mint serves the same metadata to everyone) → bare
 * `AsyncStorage`, matching the stores it replaces.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Manager } from '@cashu/coco-core';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import { z } from 'zod';
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

import { transformAuditData } from '@/features/mint/lib/auditInfo';
import type { AuditMintResponse, DiscoverMint } from '@/shared/lib/apiClient';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { normalizeMintUrlKey } from '@/shared/lib/url';

const MAX_ENTRIES = 200;

/** Freshness groups. Each stamps its own `*At` and revalidates independently. */
type MintMetaGroup = 'identity' | 'reviews' | 'audit' | 'social';

/** Per-group default staleness windows — preserve the four old stores' TTLs. */
const MINT_META_TTL_MIN: Record<MintMetaGroup, number> = {
  identity: 24 * 60,
  reviews: 60,
  audit: 60,
  social: 30,
};

const GROUP_STAMP: Record<MintMetaGroup, 'identityAt' | 'reviewsAt' | 'auditAt' | 'socialAt'> = {
  identity: 'identityAt',
  reviews: 'reviewsAt',
  audit: 'auditAt',
  social: 'socialAt',
};

export interface MintMetadataEntry {
  // identity (NUT-06 info + discover identity) — 24h
  /** Raw NUT-06 blob. Single owner now (was duplicated across info + audit caches). */
  info?: GetInfoResponse;
  displayName?: string;
  iconUrl?: string;
  description?: string;
  supportedUnits?: string[];
  identityAt?: number;
  // reviews AGGREGATE only — rows are never persisted — 60m
  averageScore?: number | null;
  reviewCount?: number;
  favouriteCount?: number;
  reviewsAt?: number;
  // audit — raw blob (swap detail) + derived scalars — 60m
  auditData?: AuditMintResponse;
  auditScore?: number | null;
  auditState?: string;
  nMints?: number;
  nMelts?: number;
  nErrors?: number;
  auditAt?: number;
  // social / operator — 30m
  contactFollowers?: number;
  contactReputation?: number | null;
  operatorPubkey?: string;
  operatorNpub?: string;
  vertexRank?: number;
  socialAt?: number;
}

interface MintMetadataState {
  byMintUrl: Record<string, MintMetadataEntry>;
  /** One-shot latch: legacy four-store import has run and old keys were removed. */
  legacyMigrated: boolean;

  getCached: (mintUrl: string) => MintMetadataEntry | undefined;
  mergeCached: (
    mintUrl: string,
    partial: Partial<MintMetadataEntry>,
    groups: MintMetaGroup[]
  ) => void;
  isStale: (mintUrl: string, group: MintMetaGroup, maxAgeMinutes?: number) => boolean;

  // Thin group setters — 1:1 replacements for the old stores' `setCached`.
  setIdentity: (mintUrl: string, info: GetInfoResponse) => void;
  setAudit: (mintUrl: string, auditData: AuditMintResponse, info?: GetInfoResponse) => void;
  setReviewsAggregate: (
    mintUrl: string,
    averageScore: number | null,
    reviewCount: number,
    favouriteCount?: number
  ) => void;
  setSocial: (
    mintUrl: string,
    followers: number,
    reputation: number | null,
    extra?: { operatorPubkey?: string; operatorNpub?: string; vertexRank?: number }
  ) => void;

  /** Bulk upsert from a nagg `/nostr/mint/discover` response. */
  upsertFromDiscover: (mints: DiscoverMint[]) => void;

  removeMint: (mintUrl: string) => void;
  clear: () => void;
}

// Envelope-only validation: `info` / `auditData` are upstream wire shapes whose
// strict definition lives in cashu-ts / the auditor; treat them as `unknown` on
// rehydrate and let consumers re-fetch on a miss.
const PersistedMintMetadataEntry = z.looseObject({
  info: z.unknown().optional(),
  displayName: z.string().max(256).optional(),
  iconUrl: z.string().max(2048).optional(),
  description: z.string().max(4096).optional(),
  supportedUnits: z.array(z.string().max(16)).max(64).optional(),
  identityAt: z.number().int().nonnegative().optional(),
  averageScore: z.number().nullable().optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  favouriteCount: z.number().int().nonnegative().optional(),
  reviewsAt: z.number().int().nonnegative().optional(),
  auditData: z.unknown().optional(),
  auditScore: z.number().nullable().optional(),
  auditState: z.string().max(32).optional(),
  nMints: z.number().int().optional(),
  nMelts: z.number().int().optional(),
  nErrors: z.number().int().optional(),
  auditAt: z.number().int().nonnegative().optional(),
  contactFollowers: z.number().int().nonnegative().optional(),
  contactReputation: z.number().nullable().optional(),
  operatorPubkey: z.string().max(128).optional(),
  operatorNpub: z.string().max(128).optional(),
  vertexRank: z.number().optional(),
  socialAt: z.number().int().nonnegative().optional(),
});

const PersistedMintMetadataStore = z.object({
  byMintUrl: z.record(z.string().max(2048), PersistedMintMetadataEntry).default({}),
  legacyMigrated: z.boolean().default(false),
});

/** Most-recent touch across all groups — drives LRU eviction. */
function lastTouched(entry: MintMetadataEntry): number {
  return Math.max(
    entry.identityAt ?? 0,
    entry.reviewsAt ?? 0,
    entry.auditAt ?? 0,
    entry.socialAt ?? 0
  );
}

function evictIfOverCap(byMintUrl: Record<string, MintMetadataEntry>): void {
  const keys = Object.keys(byMintUrl);
  if (keys.length <= MAX_ENTRIES) return;
  // Always evict at least the overflow so a bulk discover/migration write can't
  // leave the map permanently over cap; round up to a 10% batch so steady-state
  // single-entry writes don't re-sort and trim one at a time at the boundary.
  const overflow = keys.length - MAX_ENTRIES;
  const evictCount = Math.max(overflow, Math.floor(MAX_ENTRIES * 0.1));
  const sorted = keys.sort((a, b) => lastTouched(byMintUrl[a]) - lastTouched(byMintUrl[b]));
  for (let i = 0; i < evictCount; i++) delete byMintUrl[sorted[i]];
  storeLog.debug('store.mint_metadata.evicted', {
    evicted: evictCount,
    remaining: Object.keys(byMintUrl).length,
  });
}

/** Identity convenience scalars projected from a raw NUT-06 blob. */
function identityFromInfo(info: GetInfoResponse): Partial<MintMetadataEntry> {
  return {
    info,
    ...(typeof info.name === 'string' && info.name ? { displayName: info.name } : {}),
    ...(typeof info.icon_url === 'string' && info.icon_url ? { iconUrl: info.icon_url } : {}),
    ...(typeof info.description === 'string' && info.description
      ? { description: info.description }
      : {}),
  };
}

/** Audit scalars projected from a raw auditor response. */
function auditScalarsFrom(auditData: AuditMintResponse): Partial<MintMetadataEntry> {
  const { score } = transformAuditData(auditData);
  return {
    auditData,
    auditScore: typeof score === 'number' ? score : null,
    auditState: auditData.state,
    nMints: auditData.n_mints,
    nMelts: auditData.n_melts,
    nErrors: auditData.n_errors,
  };
}

export const useMintMetadataStore = create<MintMetadataState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        byMintUrl: {},
        legacyMigrated: false,

        getCached: (mintUrl) => get().byMintUrl[normalizeMintUrlKey(mintUrl)],

        mergeCached: (mintUrl, partial, groups) => {
          const key = normalizeMintUrlKey(mintUrl);
          const now = Date.now();
          const stamps: Partial<MintMetadataEntry> = {};
          for (const g of groups) stamps[GROUP_STAMP[g]] = now;
          set((state) => {
            const next = {
              ...state.byMintUrl,
              [key]: { ...state.byMintUrl[key], ...partial, ...stamps },
            };
            evictIfOverCap(next);
            return { byMintUrl: next };
          });
        },

        isStale: (mintUrl, group, maxAgeMinutes = MINT_META_TTL_MIN[group]) => {
          const entry = get().byMintUrl[normalizeMintUrlKey(mintUrl)];
          const stampedAt = entry?.[GROUP_STAMP[group]];
          if (!entry || typeof stampedAt !== 'number') return true;
          return (Date.now() - stampedAt) / (1000 * 60) > maxAgeMinutes;
        },

        setIdentity: (mintUrl, info) => {
          get().mergeCached(mintUrl, identityFromInfo(info), ['identity']);
        },

        setAudit: (mintUrl, auditData, info) => {
          const partial: Partial<MintMetadataEntry> = auditScalarsFrom(auditData);
          const groups: MintMetaGroup[] = ['audit'];
          if (info) {
            Object.assign(partial, identityFromInfo(info));
            groups.push('identity');
          }
          get().mergeCached(mintUrl, partial, groups);
        },

        setReviewsAggregate: (mintUrl, averageScore, reviewCount, favouriteCount) => {
          get().mergeCached(
            mintUrl,
            {
              averageScore,
              reviewCount,
              ...(favouriteCount !== undefined ? { favouriteCount } : {}),
            },
            ['reviews']
          );
        },

        setSocial: (mintUrl, followers, reputation, extra) => {
          get().mergeCached(
            mintUrl,
            {
              contactFollowers: followers,
              contactReputation: reputation,
              ...(extra?.operatorPubkey ? { operatorPubkey: extra.operatorPubkey } : {}),
              ...(extra?.operatorNpub ? { operatorNpub: extra.operatorNpub } : {}),
              ...(extra?.vertexRank !== undefined ? { vertexRank: extra.vertexRank } : {}),
            },
            ['social']
          );
        },

        upsertFromDiscover: (mints) => {
          const now = Date.now();
          set((state) => {
            const next = { ...state.byMintUrl };
            for (const m of mints) {
              const key = normalizeMintUrlKey(m.mintUrl);
              const prev = next[key] ?? {};
              // Stamp a group's `*At` ONLY when this row actually carried that
              // group's data — otherwise `isStale` lies and a consumer skips a
              // needed refetch.
              const hasAudit =
                m.state !== undefined ||
                m.nMints !== undefined ||
                m.nMelts !== undefined ||
                m.nErrors !== undefined;
              // A follower COUNT alone is not "social resolved": `resolveNostrProfile`
              // reads the `social` group to decide whether the operator-profile
              // fetch (which yields reputation) can be skipped. A discover row that
              // carries followers but no reputation/operator identity must leave
              // `social` stale so that fetch still runs — otherwise reputation
              // never resolves. Followers are still written below for display.
              const hasSocial =
                typeof m.vertexScore === 'number' ||
                m.operatorPubkey !== undefined ||
                m.operatorNpub !== undefined ||
                m.vertexRank !== undefined;
              next[key] = {
                ...prev,
                // identity scalars only — discover carries name/icon but NOT the
                // raw NUT-06 `info` blob, so do NOT stamp `identityAt` (that would
                // make `getCachedMintInfo` treat an aging `info` as fresh for 24h).
                ...(m.name ? { displayName: m.name } : {}),
                ...(m.iconUrl ? { iconUrl: m.iconUrl } : {}),
                ...(m.description ? { description: m.description } : {}),
                ...(m.supportedUnits ? { supportedUnits: m.supportedUnits } : {}),
                // reviews aggregate — discover always carries it (null score = no
                // scored reviews); overwriting a stale aggregate is intended (F3).
                averageScore: m.averageScore ?? null,
                ...(m.reviewCount !== undefined ? { reviewCount: m.reviewCount } : {}),
                ...(m.favouriteCount !== undefined ? { favouriteCount: m.favouriteCount } : {}),
                reviewsAt: now,
                // audit scalars (no raw swaps) — stamp only when present.
                // Use `!== undefined` (not truthiness) to match `hasAudit`, so a
                // falsy-but-present state can't stamp `auditAt` without storing it.
                ...(m.state !== undefined ? { auditState: m.state } : {}),
                ...(m.nMints !== undefined ? { nMints: m.nMints } : {}),
                ...(m.nMelts !== undefined ? { nMelts: m.nMelts } : {}),
                ...(m.nErrors !== undefined ? { nErrors: m.nErrors } : {}),
                ...(hasAudit ? { auditAt: now } : {}),
                // social — guard reputation on a real number so a `null`
                // ("unknown") row can't clobber a previously-resolved reputation.
                ...(m.followers !== undefined ? { contactFollowers: m.followers } : {}),
                ...(typeof m.vertexScore === 'number' ? { contactReputation: m.vertexScore } : {}),
                ...(m.operatorPubkey ? { operatorPubkey: m.operatorPubkey } : {}),
                ...(m.operatorNpub ? { operatorNpub: m.operatorNpub } : {}),
                ...(m.vertexRank !== undefined ? { vertexRank: m.vertexRank } : {}),
                ...(hasSocial ? { socialAt: now } : {}),
              };
            }
            evictIfOverCap(next);
            return { byMintUrl: next };
          });
          storeLog.debug('store.mint_metadata.upsert_discover', { count: mints.length });
        },

        removeMint: (mintUrl) => {
          const key = normalizeMintUrlKey(mintUrl);
          set((state) => {
            if (!state.byMintUrl[key]) return state;
            const next = { ...state.byMintUrl };
            delete next[key];
            return { byMintUrl: next };
          });
        },

        clear: () => {
          storeLog.info('store.mint_metadata.clear');
          set({ byMintUrl: {} });
        },
      }),
      persistConfig({
        name: 'mint-metadata-store',
        storage: AsyncStorage,
        schema: PersistedMintMetadataStore,
        logKey: 'mint_metadata',
        partialize: (state) => ({
          byMintUrl: state.byMintUrl,
          legacyMigrated: state.legacyMigrated,
        }),
        afterHydrate: (state, error) => {
          if (error || state?.legacyMigrated) return;
          void migrateLegacyMintCaches();
        },
      })
    )
  )
);

// ---------------------------------------------------------------------------
// Cached NUT-06 fetch (SWR) — re-homed verbatim from `mintInfoCache`. Reads the
// identity group, 24h window, dedupes concurrent fetches, writes via setIdentity.
// ---------------------------------------------------------------------------

const IDENTITY_STALE_TTL_MS = MINT_META_TTL_MIN.identity * 60 * 1000;

/** Module-level promise dedupe so concurrent miss/refresh fetches collapse to one HTTP. */
const inflight = new Map<string, Promise<GetInfoResponse>>();

/**
 * SWR fetch:
 *   - cached + fresh → resolve synchronously with the cached value
 *   - cached + stale → resolve with the cached value, kick off background refresh
 *   - miss          → await the fetcher, write through, resolve with the result
 *
 * `fetcher` receives the original `mintUrl` (not the normalized key) so coco's
 * own `normalizeMintUrl` runs unchanged inside `Manager.mint.getMintInfo`.
 */
export async function getCachedMintInfo(
  fetcher: (mintUrl: string) => Promise<GetInfoResponse>,
  mintUrl: string
): Promise<GetInfoResponse> {
  const key = normalizeMintUrlKey(mintUrl);
  const entry = useMintMetadataStore.getState().byMintUrl[key];
  const now = Date.now();
  const isFresh =
    !!entry?.info &&
    typeof entry.identityAt === 'number' &&
    now - entry.identityAt <= IDENTITY_STALE_TTL_MS;

  if (isFresh) {
    storeLog.debug('store.mint_metadata.info.hit_fresh', {
      key,
      ageMs: now - (entry.identityAt ?? 0),
    });
    return entry.info as GetInfoResponse;
  }

  if (entry?.info) {
    storeLog.info('store.mint_metadata.info.hit_stale', { key });
    refreshInBackground(fetcher, mintUrl);
    return entry.info as GetInfoResponse;
  }

  storeLog.info('store.mint_metadata.info.miss', { key });
  return fetchAndCache(fetcher, mintUrl);
}

function fetchAndCache(
  fetcher: (mintUrl: string) => Promise<GetInfoResponse>,
  mintUrl: string
): Promise<GetInfoResponse> {
  const key = normalizeMintUrlKey(mintUrl);
  const existing = inflight.get(key);
  if (existing) return existing;

  const p = (async () => {
    try {
      const info = await fetcher(mintUrl);
      useMintMetadataStore.getState().setIdentity(mintUrl, info);
      storeLog.info('store.mint_metadata.info.fetch_success', {
        key,
        hasName: typeof info.name === 'string' && info.name.length > 0,
      });
      return info;
    } catch (err) {
      storeLog.warn('store.mint_metadata.info.fetch_failed', {
        key,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function refreshInBackground(
  fetcher: (mintUrl: string) => Promise<GetInfoResponse>,
  mintUrl: string
): void {
  const key = normalizeMintUrlKey(mintUrl);
  if (inflight.has(key)) return;
  fetchAndCache(fetcher, mintUrl).catch((err) => {
    storeLog.warn('store.mint_metadata.info.swr_refresh_failed', {
      key,
      error: err instanceof Error ? err : new Error(String(err)),
    });
  });
}

/**
 * Subscribe a coco `Manager` so `mint:added` / `mint:updated` events write the
 * NUT-06 blob back into the identity group. Wire once per manager in `CocoProvider`.
 */
export function attachMintMetadataToManager(manager: Manager): () => void {
  const makeHandler =
    (_eventName: 'mint:added' | 'mint:updated') =>
    ({ mint }: { mint: { mintUrl: string; mintInfo?: GetInfoResponse } }) => {
      if (mint?.mintInfo && mint.mintUrl) {
        useMintMetadataStore.getState().setIdentity(mint.mintUrl, mint.mintInfo);
      }
    };

  const addedHandler = makeHandler('mint:added');
  const updatedHandler = makeHandler('mint:updated');
  storeLog.info('store.mint_metadata.attach_manager');
  manager.on('mint:added', addedHandler);
  manager.on('mint:updated', updatedHandler);
  return () => {
    storeLog.info('store.mint_metadata.detach_manager');
    manager.off('mint:added', addedHandler);
    manager.off('mint:updated', updatedHandler);
  };
}

// ---------------------------------------------------------------------------
// One-time legacy import. Reads the four old AsyncStorage blobs, merges them
// into the unified store keyed by normalized mint URL, sets the `legacyMigrated`
// latch (persisted → idempotent across the every-launch `afterHydrate` firing),
// then removes the old keys. No permanent fallback read — a one-shot migration.
// ---------------------------------------------------------------------------

const LEGACY_KEYS = [
  'mint-info-cache',
  'audit-mint-store',
  'mint-profile-store',
  'kym-mint-store',
] as const;

interface LegacyEnvelope {
  state?: { byMintUrl?: Record<string, unknown>; cache?: Record<string, unknown> };
}

function parseEnvelope(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as LegacyEnvelope;
    return parsed.state?.byMintUrl ?? parsed.state?.cache ?? {};
  } catch {
    return {};
  }
}

export async function migrateLegacyMintCaches(): Promise<void> {
  if (useMintMetadataStore.getState().legacyMigrated) return;
  // Batch AsyncStorage APIs may be absent under some test mocks; without them
  // there is nothing to import — skip without latching so a real launch retries.
  if (typeof AsyncStorage.multiGet !== 'function') {
    storeLog.warn('store.mint_metadata.migrate.skipped_no_batch_api');
    return;
  }
  let pairs: [string, string | null][];
  try {
    pairs = (await AsyncStorage.multiGet(LEGACY_KEYS as unknown as string[])) as [
      string,
      string | null,
    ][];
  } catch (err) {
    storeLog.warn('store.mint_metadata.migrate.read_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return;
  }
  const byKey = Object.fromEntries(pairs);
  const info = parseEnvelope(byKey['mint-info-cache']);
  const audit = parseEnvelope(byKey['audit-mint-store']);
  const profile = parseEnvelope(byKey['mint-profile-store']);
  const kym = parseEnvelope(byKey['kym-mint-store']);

  const merged: Record<string, MintMetadataEntry> = {};
  const ensure = (k: string): MintMetadataEntry => (merged[k] ??= {});

  for (const [k, v] of Object.entries(info)) {
    const e = v as { info?: GetInfoResponse; fetchedAt?: number };
    const entry = ensure(k);
    if (e.info) Object.assign(entry, identityFromInfo(e.info));
    entry.identityAt = e.fetchedAt;
  }
  for (const [k, v] of Object.entries(audit)) {
    const e = v as {
      auditData?: AuditMintResponse;
      mintInfo?: GetInfoResponse;
      timestamp?: number;
    };
    const entry = ensure(k);
    if (e.auditData) Object.assign(entry, auditScalarsFrom(e.auditData));
    if (e.mintInfo && entry.info === undefined) Object.assign(entry, identityFromInfo(e.mintInfo));
    entry.auditAt = e.timestamp;
  }
  for (const [k, v] of Object.entries(profile)) {
    const e = v as { followers?: number; reputation?: number | null; timestamp?: number };
    const entry = ensure(k);
    if (e.followers !== undefined) entry.contactFollowers = e.followers;
    if (e.reputation !== undefined) entry.contactReputation = e.reputation;
    entry.socialAt = e.timestamp;
  }
  for (const [k, v] of Object.entries(kym)) {
    const e = v as { score?: number | null; recommendations?: unknown[]; timestamp?: number };
    const entry = ensure(k);
    entry.averageScore = e.score ?? null;
    entry.reviewCount = Array.isArray(e.recommendations) ? e.recommendations.length : 0;
    entry.reviewsAt = e.timestamp;
    // recommendations (raw review rows) are intentionally dropped.
  }

  const count = Object.keys(merged).length;
  useMintMetadataStore.setState((state) => {
    const next = { ...state.byMintUrl };
    // Existing in-memory data wins: live writers (`getCachedMintInfo`,
    // `mint:added`, `upsertFromDiscover`) can populate `byMintUrl` with CURRENT
    // data during the async `multiGet` window above; spreading the legacy blob
    // first and the existing entry last keeps that fresher data.
    for (const [k, e] of Object.entries(merged)) next[k] = { ...e, ...next[k] };
    evictIfOverCap(next);
    return { byMintUrl: next, legacyMigrated: true };
  });
  storeLog.info('store.mint_metadata.migrate.done', { mints: count });

  try {
    await AsyncStorage.multiRemove(LEGACY_KEYS as unknown as string[]);
  } catch (err) {
    storeLog.warn('store.mint_metadata.migrate.cleanup_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
  }
}

/** Selector hook: re-renders only when this mint's entry changes. */
export function useCachedMintMetadata(
  mintUrl: string | null | undefined
): MintMetadataEntry | undefined {
  return useMintMetadataStore((s) =>
    mintUrl ? s.byMintUrl[normalizeMintUrlKey(mintUrl)] : undefined
  );
}
