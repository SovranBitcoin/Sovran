/**
 * @fileoverview Cross-store DATA migration registry.
 *
 * Ordered list of migration steps that reconcile data across stores / into
 * colada's model — the tier zustand's per-store `migrate` cannot serve (it only
 * sees one store's blob). `runDataMigrations()` runs every step above the
 * profile's stored level, advancing the level after each one.
 *
 * ## Adding the next migration
 * Append one `DataMigrationStep` to `DATA_MIGRATIONS`. That's it — no new flag,
 * no new useEffect. Completing `DATA_MIGRATIONS[i]` raises the level to `i + 1`.
 *
 * ## Contract
 * Each step MUST be idempotent: the level is written only AFTER `run()`
 * resolves, so a crash in between re-runs the step on next launch. Steps must
 * await hydration of any stores they read.
 */

import { useDataMigrationStore } from '@/shared/stores/profile/dataMigrationStore';
import { type AnnotationRecord, encodeAnnotation } from 'wallet';
import { useTransactionAnnotationStore } from '@/shared/stores/profile/transactionAnnotationStore';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useTransactionDistributionStore } from '@/shared/stores/profile/transactionDistributionStore';
import { useTransactionLocationStore } from '@/shared/stores/profile/transactionLocationStore';
import { useSwapTransactionsStore } from '@/shared/stores/profile/swapTransactionsStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { storeLog } from '@/shared/lib/logger';

interface DataMigrationStep {
  /** Stable, human-readable name (logging only; ordering is by array index). */
  name: string;
  /** Idempotent: safe to re-run if a crash lands between run() and persisting its level. */
  run: (assertActiveProfile: () => void) => Promise<void>;
}

/**
 * Ordered registry. Index i, once complete, sets the profile's level to i + 1.
 * NEVER reorder or remove a shipped step — only append.
 */
const DATA_MIGRATIONS: DataMigrationStep[] = [
  // 0 → 1: import the four legacy per-transaction side-data stores into colada
  // annotation keys. (The legacy stores are still dual-written today; a future
  // appended step can re-sweep + delete them once that's retired.)
  { name: 'import-legacy-tx-side-data', run: importLegacyTransactionSideData },
];

/**
 * Run all pending cross-store data migrations for the active profile. Safe to
 * call on every ColadaProvider mount — already-completed steps are skipped via
 * the persisted level. A failing step stops the run (never advances past it) so
 * ordering is preserved; it retries next launch.
 */
export async function runDataMigrations(): Promise<void> {
  const pubkey = useProfileStore.getState().getActiveProfile()?.pubkey;
  const assertActiveProfile = () => {
    if (useProfileStore.getState().getActiveProfile()?.pubkey !== pubkey) {
      throw new Error('Active profile changed during data migration');
    }
  };
  await whenHydrated(useDataMigrationStore);
  const start = useDataMigrationStore.getState().level;
  for (let i = start; i < DATA_MIGRATIONS.length; i++) {
    const step = DATA_MIGRATIONS[i];
    try {
      assertActiveProfile();
      await step.run(assertActiveProfile);
      assertActiveProfile();
      await useDataMigrationStore.setState({ level: i + 1 });
      storeLog.info('migrations.data.completed', { name: step.name, level: i + 1 });
    } catch (error) {
      storeLog.warn('migrations.data.failed', {
        name: step.name,
        fromLevel: i,
        error: error instanceof Error ? error.message : String(error),
      });
      break; // strict order — don't skip a failed step
    }
  }
}

async function whenHydrated(store: {
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

// v0.1.0 stored these fields separately. Fill gaps; current annotations win.
async function importLegacyTransactionSideData(assertActiveProfile: () => void): Promise<void> {
  await Promise.all([
    whenHydrated(useTransactionAnnotationStore),
    whenHydrated(useScanHistoryStore),
    whenHydrated(useTransactionDistributionStore),
    whenHydrated(useTransactionLocationStore),
    whenHydrated(useSwapTransactionsStore),
  ]);

  assertActiveProfile();
  const next: Record<string, AnnotationRecord> = {
    ...useTransactionAnnotationStore.getState().annotations,
  };
  const mergeInto = (key: string, record: AnnotationRecord) => {
    if (Object.keys(record).length === 0) return;
    next[key] = { ...record, ...next[key] };
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
  for (const [entryId, value] of Object.entries(useTransactionLocationStore.getState().locations)) {
    mergeInto(
      `id:${entryId}`,
      encodeAnnotation({ location: { lat: value.latitude, lng: value.longitude } })
    );
    locations += 1;
  }

  let swaps = 0;
  for (const [quoteId, ref] of Object.entries(useSwapTransactionsStore.getState().quoteIdToGroup)) {
    mergeInto(
      `quote:${quoteId}`,
      encodeAnnotation({ swap: { groupId: ref.groupId, role: ref.kind } })
    );
    swaps += 1;
  }

  // Zustand persist returns the storage write; do not checkpoint before it settles.
  await useTransactionAnnotationStore.setState({ annotations: next });
  storeLog.info('store.tx_annotation.migrated_legacy', {
    scans,
    distributions,
    locations,
    swaps,
  });
}
