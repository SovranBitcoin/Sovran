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
import {
  importLegacyTransactionSideData,
  whenHydrated,
} from '@/shared/stores/profile/transactionAnnotationStore';
import { storeLog } from '@/shared/lib/logger';

interface DataMigrationStep {
  /** Stable, human-readable name (logging only; ordering is by array index). */
  name: string;
  /** Idempotent: safe to re-run if a crash lands between run() and setLevel(). */
  run: () => Promise<void>;
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
  await whenHydrated(useDataMigrationStore);
  const start = useDataMigrationStore.getState().level;
  for (let i = start; i < DATA_MIGRATIONS.length; i++) {
    const step = DATA_MIGRATIONS[i];
    try {
      await step.run();
      useDataMigrationStore.getState().setLevel(i + 1);
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
