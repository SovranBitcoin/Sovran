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
import {
  PROFILE_PRIMARY_UNIT_ID,
  isBuiltinColorTheme,
} from '@/shared/lib/theme/builtinAlbums';
import { log } from '../logger';

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

  log.info('migrations.global.index_to_pubkey', { migratedCount, profileCount: profiles.length });
}

/**
 * Move the legacy global `settingsStore.theme` string into the active
 * profile's `theme-store` blob as a primary-unit override, then strip
 * `theme` from the persisted settings payload.
 *
 * Scope: only the active profile's theme-store is seeded. Other profiles
 * start on the default theme — post-refactor, theme is per-profile.
 * Built-in colour themes (`dark`, `navy`, …) are intentionally dropped
 * per the spec (colour themes no longer participate in the new flow).
 *
 * Idempotent: if `theme` is already absent from settings-store, exits
 * early. If the target theme-store already has a user-set album or unit
 * override, leaves it alone — the user has already interacted with the
 * new flow.
 */
async function migrateLegacyGlobalThemeToProfile(): Promise<void> {
  const settingsRaw = await AsyncStorage.getItem('settings-store');
  if (!settingsRaw) return;

  let settingsParsed: { state?: { theme?: unknown }; version?: number };
  try {
    settingsParsed = JSON.parse(settingsRaw);
  } catch {
    return;
  }

  const legacyTheme = settingsParsed?.state?.theme;
  if (typeof legacyTheme !== 'string' || !legacyTheme) {
    // Nothing to migrate — still strip the field if it somehow exists as a
    // non-string (paranoia) and exit.
    if (settingsParsed?.state && 'theme' in settingsParsed.state) {
      delete settingsParsed.state.theme;
      await AsyncStorage.setItem('settings-store', JSON.stringify(settingsParsed));
    }
    return;
  }

  const profileRaw = await AsyncStorage.getItem('profile-store');
  if (profileRaw) {
    try {
      const profileParsed = JSON.parse(profileRaw);
      const profiles: { accountIndex: number; pubkey: string }[] =
        profileParsed?.state?.profiles ?? [];
      const activeIndex: number | undefined =
        profileParsed?.state?.activeAccountIndex;
      const activeProfile =
        profiles.find((p) => p.accountIndex === activeIndex) ?? profiles[0];

      if (activeProfile?.pubkey && !isBuiltinColorTheme(legacyTheme)) {
        const themeStoreKey = `theme-store:profile:${activeProfile.pubkey}`;
        const existingRaw = await AsyncStorage.getItem(themeStoreKey);
        let existing: {
          state?: { activeAlbumSlug?: unknown; unitWallpapers?: Record<string, unknown> };
        } | null = null;
        try {
          existing = existingRaw ? JSON.parse(existingRaw) : null;
        } catch {
          existing = null;
        }
        const hasUserData =
          !!existing?.state?.activeAlbumSlug ||
          (existing?.state?.unitWallpapers &&
            Object.keys(existing.state.unitWallpapers).length > 0);

        if (!hasUserData) {
          // Write just the override — activeAlbumSlug stays null so the
          // resolver picks the single override we're seeding. Once the
          // wallpaper catalog loads, the user can reopen Theme to pick an
          // album properly.
          const nextBlob = {
            state: {
              activeAlbumSlug: null,
              unitWallpapers: { [PROFILE_PRIMARY_UNIT_ID]: legacyTheme },
              mode: 'dark',
            },
            version: 0,
          };
          await AsyncStorage.setItem(themeStoreKey, JSON.stringify(nextBlob));
          log.info('migrations.global.theme_to_profile', {
            from: legacyTheme,
            pubkeyPrefix: activeProfile.pubkey.slice(0, 8),
          });
        }
      }
    } catch (err) {
      log.warn('migrations.global.theme_profile_parse_failed', { error: String(err) });
    }
  }

  // Always strip the legacy `theme` field from settings-store so subsequent
  // rehydrates don't resurrect it.
  if (settingsParsed?.state) {
    delete settingsParsed.state.theme;
    await AsyncStorage.setItem('settings-store', JSON.stringify(settingsParsed));
  }
}

/**
 * Stamp `seedCreatedAt` for existing upgraders so they skip the wallet-restore
 * gate. Without this, every user upgrading to the version that introduced
 * walletLifecycleStore would have `seedCreatedAt = null` and be forced through
 * the /restore screen on first launch — an unnecessary disruption since their
 * existing wallet is already in sync with the mint counter.
 *
 * Heuristic: if `hasSeenOnboarding === true` in the persisted settings store,
 * the user has completed setup at least once on this install, so the seed
 * was generated by THIS app installation and no NUT-13 restore is needed.
 *
 * Idempotent: skips if `wallet-lifecycle` already contains a non-null
 * `seedCreatedAt`. New installs (no settings store, or `hasSeenOnboarding`
 * not yet true) are untouched — the lifecycle gate evaluates them normally.
 */
async function stampSeedCreatedForExistingUsers(): Promise<void> {
  const lifecycleRaw = await AsyncStorage.getItem('wallet-lifecycle');
  if (lifecycleRaw) {
    try {
      const parsed = JSON.parse(lifecycleRaw);
      if (parsed?.state?.seedCreatedAt != null) return;
    } catch {
      // unparseable — overwrite below
    }
  }

  const settingsRaw = await AsyncStorage.getItem('settings-store');
  if (!settingsRaw) return;

  let hasSeenOnboarding = false;
  try {
    const parsed = JSON.parse(settingsRaw);
    hasSeenOnboarding = parsed?.state?.hasSeenOnboarding === true;
  } catch {
    return;
  }

  if (!hasSeenOnboarding) return;

  const lifecycle = {
    state: {
      seedCreatedAt: Date.now(),
      restoreStatus: 'not-needed',
      lastRestoreAt: null,
    },
    version: 0,
  };
  await AsyncStorage.setItem('wallet-lifecycle', JSON.stringify(lifecycle));
  log.info('migrations.global.lifecycle_seeded_for_existing_user');
}

/**
 * Ordered list of global migrations. The runner skips entries whose ID
 * is already in the completed set. Each function must be safe to call
 * after a partial prior run (idempotent at the key level).
 */
const MIGRATIONS: Migration[] = [
  { id: 'index-to-pubkey-keys-v2', run: migrateIndexKeysToPubkeyKeys },
  { id: 'legacy-global-theme-to-profile-v1', run: migrateLegacyGlobalThemeToProfile },
  { id: 'wallet-lifecycle-stamp-existing-users-v1', run: stampSeedCreatedForExistingUsers },
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
      log.info('migrations.global.completed', { migrationId: migration.id });
    } catch (error) {
      log.error('migrations.global.failed', { migrationId: migration.id, error });
    }
  }
}
