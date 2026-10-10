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
import { z } from 'zod';

import { deriveNostrKeys } from '@/shared/lib/nostr/keyDerivation';
import { retrieveMnemonic } from '@/shared/lib/nostr/secureStorage';
import { PROFILE_PRIMARY_UNIT_ID, isBuiltinColorTheme } from '@/shared/lib/theme/builtinAlbums';
import { log } from '../logger';

const GLOBAL_MIGRATIONS_COMPLETED_KEY = 'global-migrations-completed';

/**
 * The store keys the index-to-pubkey migration moves. Frozen as they stood when
 * the migration shipped: it is a record of what older installs wrote, so it
 * must not follow the live store registry. Some names no longer have a store.
 */
const INDEX_TO_PUBKEY_STORE_KEYS = [
  'mint-store',
  'mint-distribution-store',
  'npc-mint-store',
  'routstr-store',
  'ai-provider-directory-store',
  'scan-history-store',
  'search-history-store',
  'recent-people-store',
  'dm-last-message-store',
  'swap-transactions-store',
  'transaction-location-store',
  'transaction-distribution-store',
  'nostr-social-store',
  'own-content-store',
  'own-profile-metadata-store',
  'vertex-budget-store',
  'nostr-relay-list-store',
  'nostr-media-server-store',
  'nostr-metadata-cache',
  'theme-store',
  'bitchat-dm-messages-store',
  'feed-ignore-store',
  'notification-policy-store',
  'nip46-connections-store',
  'nip46-activity-store',
  'transaction-annotation-store',
  'owned-media-store',
  'data-migration-store',
  'feed-cache',
  'notifications-cache',
  'dm-conversations-cache',
  'dm-messages-cache',
  'own-profile-stats-cache',
] as const;

/**
 * Names from the list above that a later release turned into a global store,
 * which reads and writes the bare key. For account 0 the bare key was also the
 * old per-account key, so moving it would take a live global store's data away
 * whenever this migration is replayed. All of them are caches: an index-keyed
 * install that still has one loses nothing by leaving it where it is.
 */
const NOW_GLOBAL_STORE_KEYS: ReadonlySet<string> = new Set(['own-profile-stats-cache']);

/**
 * A migration that returns this is not recorded as done and runs again on the
 * next launch. It is for work that can only finish once a later launch has
 * state this one does not; a failure still throws.
 */
const RUN_AGAIN = 'run-again';

interface Migration {
  id: string;
  run: () => Promise<void | typeof RUN_AGAIN>;
}

const PersistedProfileRow = z.object({
  accountIndex: z.number().int(),
  pubkey: z.string().min(1).max(128),
});
type PersistedProfileRow = z.infer<typeof PersistedProfileRow>;

const PersistedProfileStore = z.object({
  state: z.object({
    profiles: z.array(z.unknown()),
    activeAccountIndex: z.unknown().optional(),
  }),
});

interface PersistedProfiles {
  profiles: PersistedProfileRow[];
  skippedCount: number;
  activeAccountIndex: unknown;
}

/**
 * Read the profile rows a migration may act on. A row without a usable
 * `accountIndex`/`pubkey` is dropped here so no key is ever derived from it.
 * Corrupt JSON yields null and the caller must leave storage untouched; a
 * readable blob without a profile list reads as no profiles.
 */
function readPersistedProfiles(raw: string): PersistedProfiles | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const store = PersistedProfileStore.safeParse(json);
  const rows = store.success ? store.data.state.profiles : [];

  const profiles: PersistedProfileRow[] = [];
  for (const row of rows) {
    const profile = PersistedProfileRow.safeParse(row);
    if (profile.success) profiles.push(profile.data);
  }
  return {
    profiles,
    skippedCount: rows.length - profiles.length,
    activeAccountIndex: store.success ? store.data.state.activeAccountIndex : undefined,
  };
}

/**
 * Carry over an install from before profiles existed (0.0.45 to 0.0.56). It has
 * no `profile-store`; its one account's stores sit under bare keys and its root
 * phrase is in SecureStore. The keys provider is about to create account 0 from
 * that phrase, so the pubkey is derived here the same way and each bare value is
 * copied to that account's key.
 *
 * The bare keys are left for this launch. Until account 0 has a row, a store
 * that loads reads its bare key, and one that found it gone would later save
 * defaults over the copy. `RUN_AGAIN` brings the migration back next launch,
 * when the row exists and the loop in `migrateIndexKeysToPubkeyKeys` removes
 * them.
 *
 * Without a readable, valid phrase nothing is copied and nothing is removed,
 * and the migration comes back next launch.
 */
async function copyPreProfileStoresToAccountZero(): Promise<void | typeof RUN_AGAIN> {
  const bareStores: [base: string, data: string][] = [];
  for (const base of INDEX_TO_PUBKEY_STORE_KEYS) {
    if (NOW_GLOBAL_STORE_KEYS.has(base)) continue;
    const data = await AsyncStorage.getItem(base);
    if (data) bareStores.push([base, data]);
  }
  // A fresh install ends here, before the keychain is read.
  if (bareStores.length === 0) return;

  let pubkey: string;
  try {
    // Null covers absent, unreadable and invalid; the read logs which.
    const phrase = await retrieveMnemonic();
    if (!phrase) {
      log.warn('migrations.global.pre_profile.phrase_unavailable', {
        storeCount: bareStores.length,
      });
      // The keychain may only be unreadable for now. Recording the migration
      // here would leave these stores behind for good once it reads again.
      return RUN_AGAIN;
    }
    pubkey = deriveNostrKeys(phrase, 0).pubkey;
  } catch {
    // The error is not logged: it may quote the phrase.
    log.warn('migrations.global.pre_profile.derivation_failed', { storeCount: bareStores.length });
    return RUN_AGAIN;
  }

  let copiedCount = 0;
  for (const [base, data] of bareStores) {
    const newKey = `${base}:profile:${pubkey}`;
    // An earlier launch may have copied this already, and saved over it since.
    if ((await AsyncStorage.getItem(newKey)) !== null) continue;
    await AsyncStorage.setItem(newKey, data);
    copiedCount++;
  }

  log.info('migrations.global.pre_profile.copied', {
    copiedCount,
    storeCount: bareStores.length,
    pubkeyPrefix: pubkey.slice(0, 8),
  });
  return RUN_AGAIN;
}

/**
 * Releases 0.0.62 to 0.1.3 recorded the key migration on an install that had
 * no profile list yet (one that began before 0.0.57), without moving anything.
 * Account 0's stores from that time are still under their bare keys, a paid
 * Routstr key possibly among them, and nothing reads them.
 *
 * A leftover is adopted only where account 0 has nothing under its own key:
 * what the account saved since is never replaced, and in that case the
 * leftover stays where it is. A copy is read back before its source goes.
 */
async function adoptLeftoverBareStores(): Promise<void | typeof RUN_AGAIN> {
  const leftovers: [base: string, data: string][] = [];
  for (const base of INDEX_TO_PUBKEY_STORE_KEYS) {
    if (NOW_GLOBAL_STORE_KEYS.has(base)) continue;
    const data = await AsyncStorage.getItem(base);
    if (data) leftovers.push([base, data]);
  }
  if (leftovers.length === 0) return;

  const raw = await AsyncStorage.getItem('profile-store');
  const accountZero = raw
    ? readPersistedProfiles(raw)?.profiles.find((profile) => profile.accountIndex === 0)
    : undefined;
  // No account 0 yet: the pre-profile copy above is still in progress, or the
  // list cannot be read. Either way, look again next launch.
  if (!accountZero) return RUN_AGAIN;

  // The leftovers were written by the first account of the stored phrase. An
  // imported identity at index 0, or one from another phrase, is not their
  // owner: they stay where they are.
  let owner: string;
  try {
    const phrase = await retrieveMnemonic();
    if (!phrase) return RUN_AGAIN;
    owner = deriveNostrKeys(phrase, 0).pubkey;
  } catch {
    // The error is not logged: it may quote the phrase.
    return RUN_AGAIN;
  }
  if (owner !== accountZero.pubkey) {
    log.warn('migrations.global.leftover_bare_stores.not_owner', {
      leftoverCount: leftovers.length,
    });
    return;
  }

  let adoptedCount = 0;
  let unconfirmed = false;
  for (const [base, data] of leftovers) {
    const ownKey = `${base}:profile:${owner}`;
    if ((await AsyncStorage.getItem(ownKey)) !== null) continue;
    await AsyncStorage.setItem(ownKey, data);
    if ((await AsyncStorage.getItem(ownKey)) !== data) {
      // A save can be dropped without an error. Try again next launch.
      unconfirmed = true;
      continue;
    }
    await AsyncStorage.removeItem(base);
    adoptedCount++;
  }
  log.info('migrations.global.leftover_bare_stores', {
    adoptedCount,
    leftoverCount: leftovers.length,
  });
  if (unconfirmed) return RUN_AGAIN;
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
 *
 * An install with no profile-store at all predates profiles and is handled by
 * `copyPreProfileStoresToAccountZero`.
 */
async function migrateIndexKeysToPubkeyKeys(): Promise<void | typeof RUN_AGAIN> {
  const raw = await AsyncStorage.getItem('profile-store');
  if (raw === null) return copyPreProfileStoresToAccountZero();
  if (!raw) return;

  const persisted = readPersistedProfiles(raw);
  if (!persisted) {
    log.warn('migrations.global.index_to_pubkey.profile_store_unreadable');
    return;
  }
  const { profiles, skippedCount } = persisted;
  if (skippedCount > 0)
    log.warn('migrations.global.index_to_pubkey.rows_skipped', { skippedCount });
  if (profiles.length === 0) return;

  let migratedCount = 0;

  for (const profile of profiles) {
    for (const base of INDEX_TO_PUBKEY_STORE_KEYS) {
      const oldKey = profile.accountIndex === 0 ? base : `${base}:profile:${profile.accountIndex}`;
      const newKey = `${base}:profile:${profile.pubkey}`;

      if (oldKey === newKey) continue;
      if (oldKey === base && NOW_GLOBAL_STORE_KEYS.has(base)) continue;

      const oldData = await AsyncStorage.getItem(oldKey);
      if (!oldData) continue;

      // A partially completed upgrade may already have newer profile data.
      if ((await AsyncStorage.getItem(newKey)) === null) {
        await AsyncStorage.setItem(newKey, oldData);
      }
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

  let settingsParsed: { state?: unknown; version?: number } | null;
  try {
    settingsParsed = JSON.parse(settingsRaw);
  } catch {
    return;
  }

  // Valid JSON can still hold a string, number, null or array where the state
  // object belongs. There is no theme to move, and `in` throws on a primitive,
  // which would fail this migration on every launch. The blob is left as it is.
  const rawState = settingsParsed?.state;
  if (typeof rawState !== 'object' || rawState === null || Array.isArray(rawState)) return;
  const settingsState: { theme?: unknown } = rawState;

  const legacyTheme = settingsState.theme;
  if (typeof legacyTheme !== 'string' || !legacyTheme) {
    // Nothing to migrate — still strip the field if it somehow exists as a
    // non-string (paranoia) and exit.
    if ('theme' in settingsState) {
      delete settingsState.theme;
      await AsyncStorage.setItem('settings-store', JSON.stringify(settingsParsed));
    }
    return;
  }

  const profileRaw = await AsyncStorage.getItem('profile-store');
  if (profileRaw) {
    const persisted = readPersistedProfiles(profileRaw);
    if (!persisted) {
      log.warn('migrations.global.theme_to_profile.profile_store_unreadable');
      return;
    }
    const { profiles, skippedCount, activeAccountIndex } = persisted;
    // The first-row fallback only holds when every row was readable; a skipped
    // row may have been the active one, so nothing is seeded in its place.
    const activeProfile =
      profiles.find((p) => p.accountIndex === activeAccountIndex) ??
      (skippedCount === 0 ? profiles[0] : undefined);

    if (activeProfile && !isBuiltinColorTheme(legacyTheme)) {
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
        (existing?.state?.unitWallpapers && Object.keys(existing.state.unitWallpapers).length > 0);

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
  }

  // Strip only after the destination write succeeds. A failed write must
  // preserve the source and leave this migration pending for the next launch.
  delete settingsState.theme;
  await AsyncStorage.setItem('settings-store', JSON.stringify(settingsParsed));
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
 * `seedCreatedAt`, or records any restore decision. New installs (no settings store, or `hasSeenOnboarding`
 * not yet true) are untouched — the lifecycle gate evaluates them normally.
 */
async function stampSeedCreatedForExistingUsers(): Promise<void> {
  const lifecycleRaw = await AsyncStorage.getItem('wallet-lifecycle');
  if (lifecycleRaw) {
    try {
      const parsed = JSON.parse(lifecycleRaw);
      if (parsed?.state?.seedCreatedAt != null) return;
      // A restore that has been asked for or started is a decision, not a
      // missing stamp. The stamp exists for upgraders who never had this
      // store; if this migration is ever replayed (its completion marker
      // could not be read), it must not turn a pending restore into
      // "not needed" and let the wallet skip it.
      const restoreStatus: unknown = parsed?.state?.restoreStatus;
      if (restoreStatus !== undefined && restoreStatus !== 'unknown') return;
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
  { id: 'adopt-leftover-bare-stores-v1', run: adoptLeftoverBareStores },
  { id: 'legacy-global-theme-to-profile-v1', run: migrateLegacyGlobalThemeToProfile },
  { id: 'wallet-lifecycle-stamp-existing-users-v1', run: stampSeedCreatedForExistingUsers },
];

/**
 * A read that throws is not an empty marker: it propagates, the run stops and
 * storage stays closed. A marker that reads but does not parse cannot be
 * retried into health, so it is treated as empty and every migration is
 * replayed; each one is safe to replay (`globalMigrationsRunner.test.ts`).
 */
async function readCompletedMigrationIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(GLOBAL_MIGRATIONS_COMPLETED_KEY);
  if (!raw) return new Set();

  try {
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    );
  } catch {
    log.warn('migrations.global.marker_unparseable');
    return new Set();
  }
}

async function writeCompletedMigrationIds(completedIds: Set<string>): Promise<void> {
  await AsyncStorage.setItem(
    GLOBAL_MIGRATIONS_COMPLETED_KEY,
    JSON.stringify(Array.from(completedIds).sort())
  );
}

/**
 * Runs every pending migration in order and throws on the first that fails.
 *
 * Throwing is what keeps profile storage closed: `GlobalMigrationGate` opens it
 * only when this resolves. Carrying on would let stores load defaults and
 * write them over the keys a half-finished migration was still moving. A
 * migration that completed keeps its marker, so a retry resumes at the failure.
 */
export async function runGlobalMigrations(): Promise<void> {
  const completedIds = await readCompletedMigrationIds();

  for (const migration of MIGRATIONS) {
    if (completedIds.has(migration.id)) continue;

    try {
      if ((await migration.run()) === RUN_AGAIN) {
        log.info('migrations.global.run_again', { migrationId: migration.id });
        continue;
      }
      completedIds.add(migration.id);
      await writeCompletedMigrationIds(completedIds);
      log.info('migrations.global.completed', { migrationId: migration.id });
    } catch (error) {
      log.error('migrations.global.failed', { migrationId: migration.id, error });
      throw error;
    }
  }
}
