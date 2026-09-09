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
 * its import and tracks completion via a numeric level.
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { z } from 'zod';

import type { AnnotationRecord, AnnotationStoreAdapter, TransactionAnnotation } from 'wallet';
import { encodeAnnotation } from 'wallet';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';
import { tolerantRecord } from '@/shared/lib/persist/tolerant';

interface TransactionAnnotationState {
  /** colada annotation key -> flat annotation record. */
  annotations: Record<string, AnnotationRecord>;
}

const AnnotationRecordSchema = z.record(z.string().max(64), z.string().max(16_384));

const PersistedTransactionAnnotationStore = z.object({
  // Contain malformed entries (including historical raw-token keys >256 chars)
  // without discarding valid annotations from the same profile.
  annotations: tolerantRecord(z.string().max(256), AnnotationRecordSchema),
});

// Exported only for the dev-gated e2e state mirror; app code goes through the
// adapter/function API below.
export const useTransactionAnnotationStore = create<TransactionAnnotationState>()(
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
