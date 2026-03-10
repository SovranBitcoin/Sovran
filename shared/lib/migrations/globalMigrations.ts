/**
 * @fileoverview Global Migration Registry
 *
 * Centralised, ordered list of app-wide migrations that run once at startup
 * before any account-scoped provider mounts. Each migration is tracked by a
 * unique ID persisted in a single AsyncStorage key so it only executes once.
 *
 * Adding a migration:
 *   1. Write an idempotent async function.
 *   2. Append a new entry to MIGRATIONS with a unique id.
 *   3. The runner executes entries in array order, skipping already-completed IDs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { PROFILE_SCOPED_STORE_KEYS } from '@/shared/lib/cashu/profileScopedStorage';

const GLOBAL_MIGRATIONS_COMPLETED_KEY = 'global-migrations-completed';

interface Migration {
  id: string;
  run: () => Promise<void>;
}

/**
 * Migrate all profile-scoped Zustand stores from the old index-based
 * AsyncStorage key format to the current pubkey-based format.
 *
 * Old (v0.0.60):
 *   account 0  → bare key    e.g. `routstr-store`
 *   account N  → `{base}:profile:{N}` e.g. `routstr-store:profile:1`
 *
 * New:
 *   all accounts → `{base}:profile:{pubkey}`
 *
 * Reads profile-store directly from AsyncStorage (no Zustand dependency)
 * so it can run before any store hydrates.
 */
async function migrateIndexKeysToPubkeyKeys(): Promise<void> {
  const raw = await AsyncStorage.getItem('profile-store');
  if (!raw) return;

  const parsed = JSON.parse(raw);
  const profiles: { accountIndex: number; pubkey: string }[] = parsed?.state?.profiles ?? [];
  if (profiles.length === 0) return;

  let migratedCount = 0;

  for (const profile of profiles) {
    for (const base of PROFILE_SCOPED_STORE_KEYS) {
      const oldKey = profile.accountIndex === 0 ? base : `${base}:profile:${profile.accountIndex}`;
      const newKey = `${base}:profile:${profile.pubkey}`;

      if (oldKey === newKey) continue;

      const oldData = await AsyncStorage.getItem(oldKey);
      if (!oldData) continue;

      await AsyncStorage.setItem(newKey, oldData);
      await AsyncStorage.removeItem(oldKey);
      migratedCount++;
    }
  }

  console.log(
    `[GlobalMigrations] index-to-pubkey: moved ${migratedCount} keys across ${profiles.length} profiles`
  );
}

/**
 * Ordered list of global migrations. The runner skips entries whose ID
 * is already in the completed set. Each function must be safe to call
 * after a partial prior run (idempotent at the key level).
 */
const MIGRATIONS: Migration[] = [
  { id: 'index-to-pubkey-v2', run: migrateIndexKeysToPubkeyKeys },
];

async function readCompletedMigrationIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(GLOBAL_MIGRATIONS_COMPLETED_KEY);
    if (!raw) return new Set();

    const parsed = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    );
  } catch {
    return new Set();
  }
}

async function writeCompletedMigrationIds(completedIds: Set<string>): Promise<void> {
  await AsyncStorage.setItem(
    GLOBAL_MIGRATIONS_COMPLETED_KEY,
    JSON.stringify(Array.from(completedIds).sort())
  );
}

export async function runGlobalMigrations(): Promise<void> {
  const completedIds = await readCompletedMigrationIds();

  for (const migration of MIGRATIONS) {
    if (completedIds.has(migration.id)) continue;

    try {
      await migration.run();
      completedIds.add(migration.id);
      await writeCompletedMigrationIds(completedIds);
      console.log(`[GlobalMigrations] Completed: ${migration.id}`);
    } catch (error) {
      console.error(`[GlobalMigrations] Migration "${migration.id}" failed:`, error);
    }
  }
}
