/**
 * @fileoverview Cross-store DATA migration level (profile-scoped).
 *
 * This is the home for migrations that reconcile data ACROSS stores or into
 * colada's model — work that zustand's per-store `migrate` cannot do (it only
 * sees one store's blob). It tracks a monotonic high-water mark; the ordered
 * registry in `shared/lib/migrations/dataMigrations.ts` runs every step above
 * the stored level once per profile, then advances it.
 *
 * Distinct from the two existing tiers:
 *   - per-store SHAPE migration → zustand `version` + `migrate` (persistConfig)
 *   - device-global pre-hydration → shared/lib/migrations/globalMigrations.ts
 *
 * To add the next migration: append one step to `DATA_MIGRATIONS` — no new flag.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';

import { createProfileScopedStorage } from '@/shared/lib/cashu/profileScopedStorage';
import { persistConfig } from '@/shared/lib/persist/persistConfig';

interface DataMigrationState {
  /** Highest cross-store data-migration step this profile has completed. */
  level: number;
  setLevel: (level: number) => void;
}

const PersistedDataMigrationStore = z.object({
  level: z.number().int().nonnegative().default(0),
});

export const useDataMigrationStore = create<DataMigrationState>()(
  persist(
    (set) => ({
      level: 0,
      setLevel: (level: number) => set({ level }),
    }),
    persistConfig({
      name: 'data-migration-store',
      storage: createProfileScopedStorage(),
      schema: PersistedDataMigrationStore,
      logKey: 'data_migration',
      partialize: (state) => ({ level: state.level }),
    })
  )
);
