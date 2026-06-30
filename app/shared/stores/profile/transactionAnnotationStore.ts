/**
 * @fileoverview Transaction annotation store (profile-scoped persistence)
 *
 * Backs colada's `AnnotationStoreAdapter` with MMKV/AsyncStorage so the
 * per-transaction side-data colada owns (counterparty, scan source, P2PK lock,
 * distribution, location, swap grouping) survives restart and stays
 * profile-isolated. colada owns the model, keying, and selectors; this store is
 * pure persistence keyed by colada's annotation keys (`raw:`/`quote:`/`op:`/`id:`).
 *
 * Profile switches do a full app reload (profileSessionOrchestrator), so the
 * store + adapter are recreated per profile — no cross-profile bleed.
 *
 * Legacy data (scan-history transaction links, distribution, location) is
 * imported per profile by the `dataMigrations` registry, which calls
 * `importLegacyTransactionSideData` and tracks completion via a numeric level.
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { z } from 'zod';

import type {
  AnnotationRecord,
  AnnotationStoreAdapter,
  TransactionAnnotation,
} from 'wallet';
import { encodeAnnotation } from 'wallet';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { storeLog } from '@/shared/lib/logger';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

interface TransactionAnnotationState {
  /** colada annotation key -> flat annotation record. */
  annotations: Record<string, AnnotationRecord>;
}

const PersistedTransactionAnnotationStore = z.object({
  annotations: z
    .record(z.string().max(256), z.record(z.string().max(64), z.string().max(16_384)))
    .default({}),
  // (legacy `_migratedLegacy` flag removed — the cross-store import is now
  // tracked by dataMigrationStore's level. Old blobs carrying the field still
  // validate via the loose record and it simply ages out.)
});

const useTransactionAnnotationStore = create<TransactionAnnotationState>()(
  subscribeWithSelector(
    persist(
      (): TransactionAnnotationState => ({
        annotations: {},
      }),
      persistConfig({
        name: 'transaction-annotation-store',
        storage: createProfileScopedStorage(),
        schema: PersistedTransactionAnnotationStore,
        logKey: 'tx_annotation',
        partialize: (state) => ({
          annotations: state.annotations,
        }),
      })
    )
  )
);

/** Field-level additive merge of a patch into the record at `key`. */
function applyPatch(key: string, patch: AnnotationRecord): void {
  if (Object.keys(patch).length === 0) return;
  useTransactionAnnotationStore.setState((state) => ({
    annotations: {
      ...state.annotations,
      [key]: { ...(state.annotations[key] ?? {}), ...patch },
    },
  }));
}

/**
 * The adapter colada consumes. Reads are synchronous (render path); the backing
 * MMKV/AsyncStorage write happens via zustand persist after `set`.
 */
export const transactionAnnotationAdapter: AnnotationStoreAdapter = {
  get: (key) => useTransactionAnnotationStore.getState().annotations[key],
  getMany: (keys) => {
    const { annotations } = useTransactionAnnotationStore.getState();
    return keys.map((key) => annotations[key]);
  },
  set: applyPatch,
  has: (key) => key in useTransactionAnnotationStore.getState().annotations,
  subscribe: (listener) =>
    useTransactionAnnotationStore.subscribe((state, prev) => {
      if (state.annotations !== prev.annotations) listener();
    }),
};

// ---------------------------------------------------------------------------
// Imperative writers (for non-React payment-flow modules)
// ---------------------------------------------------------------------------

/** Write an annotation patch under an explicit colada key. */
export function setTransactionAnnotation(key: string, patch: TransactionAnnotation): void {
  applyPatch(key, encodeAnnotation(patch));
}

/** Bridge a preview/raw key onto a final entry key (additive). */
export function linkTransactionAnnotation(fromKey: string, toKey: string): void {
  const record = transactionAnnotationAdapter.get(fromKey);
  if (record) applyPatch(toKey, record);
}

/**
 * Record an outbound distribution under a `quote:`/`id:` key, first-write-wins —
 * a later `displayed` inference cannot clobber a real copy/share/airdrop, and a
 * real action recorded after `displayed` is also ignored (matches the legacy
 * distribution store's guard).
 */
export function setDistributionAnnotation(
  key: string,
  source: NonNullable<TransactionAnnotation['distribution']>['source']
): void {
  if (transactionAnnotationAdapter.get(key)?.distributionSource) return;
  applyPatch(key, encodeAnnotation({ distribution: { source } }));
}

// ---------------------------------------------------------------------------
// One-time legacy migration
// ---------------------------------------------------------------------------

export async function whenHydrated(store: {
  persist: { hasHydrated: () => boolean; onFinishHydration: (cb: () => void) => () => void };
}): Promise<void> {
  if (store.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsub = store.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

/**
 * Import legacy per-transaction side-data into annotation keys. Distribution
 * rows are written under both `quote:` and `id:` (the old store keyed mint
 * quotes by quoteId, others by entry id); scan + location rows key by
 * `id:<transactionId>`. colada's `mergeAnnotationRecords` recombines them across
 * an entry's candidate keys at read time.
 *
 * Idempotent + additive (first-write-wins for distribution): safe to re-run, so
 * the dataMigrations registry can drive it via a level rather than a one-shot
 * flag, and a future "retire legacy stores" step can re-sweep before deleting.
 */
export async function importLegacyTransactionSideData(): Promise<void> {
  try {
    const [
      { useScanHistoryStore },
      { useTransactionDistributionStore },
      { useTransactionLocationStore },
      { useSwapTransactionsStore },
    ] = await Promise.all([
      import('@/shared/stores/profile/scanHistoryStore'),
      import('@/shared/stores/profile/transactionDistributionStore'),
      import('@/shared/stores/profile/transactionLocationStore'),
      import('@/shared/stores/profile/swapTransactionsStore'),
    ]);

    await Promise.all([
      whenHydrated(useTransactionAnnotationStore),
      whenHydrated(useScanHistoryStore),
      whenHydrated(useTransactionDistributionStore),
      whenHydrated(useTransactionLocationStore),
      whenHydrated(useSwapTransactionsStore),
    ]);

    const next: Record<string, AnnotationRecord> = {
      ...useTransactionAnnotationStore.getState().annotations,
    };
    const mergeInto = (key: string, record: AnnotationRecord) => {
      if (Object.keys(record).length === 0) return;
      next[key] = { ...(next[key] ?? {}), ...record };
    };

    let scans = 0;
    for (const entry of useScanHistoryStore.getState().entries) {
      if (!entry.transactionId) continue;
      mergeInto(
        `id:${entry.transactionId}`,
        encodeAnnotation({
          scan: {
            method: entry.source,
            raw: entry.raw,
            container: entry.container,
            optionKinds: entry.optionKinds,
            inputType: entry.inputType,
          },
        })
      );
      scans += 1;
    }

    let distributions = 0;
    for (const [key, value] of Object.entries(
      useTransactionDistributionStore.getState().distributions
    )) {
      const record = encodeAnnotation({ distribution: { source: value.source } });
      mergeInto(`quote:${key}`, record);
      mergeInto(`id:${key}`, record);
      distributions += 1;
    }

    let locations = 0;
    for (const [entryId, value] of Object.entries(
      useTransactionLocationStore.getState().locations
    )) {
      mergeInto(
        `id:${entryId}`,
        encodeAnnotation({ location: { lat: value.latitude, lng: value.longitude } })
      );
      locations += 1;
    }

    let swaps = 0;
    for (const [quoteId, ref] of Object.entries(
      useSwapTransactionsStore.getState().quoteIdToGroup
    )) {
      mergeInto(
        `quote:${quoteId}`,
        encodeAnnotation({ swap: { groupId: ref.groupId, role: ref.kind } })
      );
      swaps += 1;
    }

    useTransactionAnnotationStore.setState({ annotations: next });
    storeLog.info('store.tx_annotation.migrated_legacy', {
      scans,
      distributions,
      locations,
      swaps,
    });
  } catch (error) {
    storeLog.warn('store.tx_annotation.migrate_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
