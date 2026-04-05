import { CocoManager } from '@/shared/lib/cashu/manager';
import { DataMigration } from '@/shared/lib/cashu/migration';
import { log, initLog } from '../logger';
import {
  deriveCashuMnemonic,
  deriveNostrKeys,
  type DerivedNostrKeys,
} from '@/shared/lib/nostr/keyDerivation';
import { retrieveMnemonic, storeMnemonic } from '@/shared/lib/nostr/secureStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { migrateSettingsFromRedux } from '@/shared/stores/global/migrateSettings';
import { store } from '@/redux/store/store.deprecated';
import type { RootState } from '@/redux/store/reducer.deprecated';

type LegacyReduxProfile = {
  id?: number;
  mnemonic?: string;
  pubkey?: string;
};

function getReduxState(): RootState {
  return store.getState() as unknown as RootState;
}

async function ensureProfileStoreHydrated(): Promise<void> {
  if (useProfileStore.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsub = useProfileStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}

function getLegacyReduxProfiles(rootState: RootState): LegacyReduxProfile[] {
  const profiles = rootState.nostr?.profiles;
  return Array.isArray(profiles) ? profiles : [];
}

function getLegacyCurrentProfileIndex(rootState: RootState): number {
  return typeof rootState.nostr?.currentProfile?.id === 'number'
    ? rootState.nostr.currentProfile.id
    : 0;
}

function getLegacyReduxMnemonic(profile: LegacyReduxProfile | undefined): string | null {
  const mnemonic = profile?.mnemonic?.trim();
  if (!mnemonic) return null;

  const words = mnemonic.split(/\s+/);
  return words.length === 12 ? mnemonic : null;
}

async function bootstrapRootMnemonic(rootState: RootState): Promise<string | null> {
  const existing = await retrieveMnemonic();
  if (existing) return existing;

  const profile0 = getLegacyReduxProfiles(rootState)[0];
  const legacyMnemonic = getLegacyReduxMnemonic(profile0);
  if (!legacyMnemonic) return null;

  const stored = await storeMnemonic(legacyMnemonic);
  return stored ? legacyMnemonic : null;
}

function deriveLegacyProfilePubkey(
  profile: LegacyReduxProfile,
  fallbackRootMnemonic: string | null,
  accountIndex: number
): string | null {
  if (profile.pubkey?.trim()) {
    return profile.pubkey.trim();
  }

  const mnemonic = getLegacyReduxMnemonic(profile) ?? fallbackRootMnemonic;
  if (!mnemonic) return null;

  try {
    const keys: DerivedNostrKeys = deriveNostrKeys(
      mnemonic,
      mnemonic === fallbackRootMnemonic ? accountIndex : 0
    );
    return keys.pubkey;
  } catch {
    return null;
  }
}

async function bootstrapProfileStore(
  rootState: RootState,
  rootMnemonic: string | null
): Promise<void> {
  await ensureProfileStoreHydrated();

  const legacyProfiles = getLegacyReduxProfiles(rootState);
  if (legacyProfiles.length === 0) return;

  const existingState = useProfileStore.getState();
  for (const [index, profile] of legacyProfiles.entries()) {
    const accountIndex = typeof profile.id === 'number' ? profile.id : index;

    // Skip expensive key derivation if profile already exists in persisted store
    if (existingState.profiles.some((p) => p.accountIndex === accountIndex)) {
      continue;
    }

    const pubkey = deriveLegacyProfilePubkey(profile, rootMnemonic, accountIndex);
    if (!pubkey) continue;

    existingState.addProfile(accountIndex, pubkey);
  }

  const activeAccountIndex = existingState.activeAccountIndex;
  const legacyActiveIndex = getLegacyCurrentProfileIndex(rootState);
  const hasActiveProfile = useProfileStore
    .getState()
    .profiles.some((profile) => profile.accountIndex === activeAccountIndex);
  const hasLegacyActiveProfile = useProfileStore
    .getState()
    .profiles.some((profile) => profile.accountIndex === legacyActiveIndex);

  if ((!hasActiveProfile || existingState.profiles.length === 0) && hasLegacyActiveProfile) {
    useProfileStore.setState({ activeAccountIndex: legacyActiveIndex });
  }
}

function getCashuMigrationAccountIndexes(rootState: RootState): number[] {
  const cashuProfiles = rootState.cashu?.profiles;
  if (!Array.isArray(cashuProfiles)) return [];

  return cashuProfiles
    .map((profile, index) => {
      const hasData =
        !!profile &&
        (Array.isArray(profile.mints) && profile.mints.length > 0
          ? true
          : Object.keys(profile.proofs ?? {}).length > 0 ||
            Object.keys(profile.counters ?? {}).length > 0);
      return hasData ? index : null;
    })
    .filter((index): index is number => index != null);
}

async function migrateReduxCashuProfiles(
  rootState: RootState,
  rootMnemonic: string | null
): Promise<void> {
  if (!rootMnemonic) return;

  const accountIndexes = getCashuMigrationAccountIndexes(rootState);
  if (accountIndexes.length === 0) return;

  for (const accountIndex of accountIndexes) {
    if (useProfileStore.getState().isCocoMigrationComplete(accountIndex)) {
      continue;
    }

    try {
      const keys = deriveNostrKeys(rootMnemonic, accountIndex);
      const cashuMnemonic = deriveCashuMnemonic(rootMnemonic, accountIndex);

      CocoManager.setAccountIndex(accountIndex);
      CocoManager.setSignerKey(keys.privateKey);
      CocoManager.setCashuMnemonic(cashuMnemonic);

      const manager = await CocoManager.initialize();
      const migration = new DataMigration(manager, accountIndex);
      const needsMigration = await migration.isMigrationNeeded();

      if (needsMigration) {
        const result = await migration.migrateFromRedux();
        if (result.errors.length > 0) {
          log.warn('migrations.legacy.completed_with_errors', { accountIndex, errors: result.errors });
        }
      }

      useProfileStore.getState().markCocoMigrationComplete(accountIndex);
    } finally {
      await CocoManager.cleanup();
    }
  }
}

/**
 * Bootstrap the current storage model from a legacy Redux-based install.
 *
 * Order matters:
 * 1. PersistGate must already have rehydrated the deprecated Redux store
 * 2. Root mnemonic is copied into SecureStore if needed
 * 3. Profile store is reconstructed so later key-shape migrations can map index keys
 * 4. Redux settings are copied into Zustand if the new store is still empty
 * 5. Legacy Cashu data is migrated into Coco/profile-scoped storage
 */
export async function runLegacyReduxBootstrap(): Promise<void> {
  const rootState = getReduxState();

  initLog('LegacyReduxBootstrap', 'starting');

  const rootMnemonic = await bootstrapRootMnemonic(rootState);
  await bootstrapProfileStore(rootState, rootMnemonic);
  await migrateSettingsFromRedux(rootState);
  await migrateReduxCashuProfiles(rootState, rootMnemonic);

  initLog('LegacyReduxBootstrap', 'complete');
}
