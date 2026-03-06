/**
 * @fileoverview Profile session orchestration for switch/create/import/delete flows.
 *
 * All profile operations now call the orchestrator directly (no WalletScreen action queue).
 * The orchestrator coordinates: CocoManager cleanup, profileStore updates, AsyncStorage flush,
 * and a native app restart via `restartApp()`.
 *
 * Transition guard uses AsyncStorage so it survives native restarts and is cleared on next startup.
 *
 * Callers can optionally supply resetStages/cancelResetStages (via registerTransitionControls)
 * to show a splash overlay during the transition. If not registered, transitions proceed without
 * the splash overlay.
 *
 * Key derivation (getKeysForAccount) is registered at runtime by a component inside
 * AccountScopedProviders via registerKeyDerivation(). This avoids prop-threading from
 * the drawer/sheet all the way to the orchestrator.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';

// ── AsyncStorage-based transition guard ──────────────────────────
const TRANSITION_KEY = 'profile-transition-in-progress';
const TRANSITION_EXPIRY_MS = 10_000;

type TransitionGuard = { startedAt: number };

async function beginTransition(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(TRANSITION_KEY);
    if (raw) {
      const guard: TransitionGuard = JSON.parse(raw);
      if (Date.now() - guard.startedAt < TRANSITION_EXPIRY_MS) {
        return false;
      }
      console.warn('[ProfileOrchestrator] Stale transition guard expired');
    }
    await AsyncStorage.setItem(TRANSITION_KEY, JSON.stringify({ startedAt: Date.now() }));
    return true;
  } catch {
    return true;
  }
}

async function endTransition(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRANSITION_KEY);
  } catch {
    // best-effort
  }
}

/** Call on app startup to clear any stale transition guard left by a previous run. */
export async function clearTransitionGuardOnStartup(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TRANSITION_KEY);
  } catch {
    // best-effort
  }
}

// ── Registered controls (set at runtime by layout components) ────
type TransitionControls = {
  resetStages: (options?: { holdUntilCancel?: boolean }) => void;
  cancelResetStages: () => void;
};

type KeyDerivationFn = (accountIndex: number) => Promise<{ pubkey: string } | null>;

let registeredControls: TransitionControls | null = null;
let registeredKeyDerivation: KeyDerivationFn | null = null;

export function registerTransitionControls(controls: TransitionControls): void {
  registeredControls = controls;
}

export function registerKeyDerivation(fn: KeyDerivationFn): void {
  registeredKeyDerivation = fn;
}

async function flushProfileStoreToDisk(): Promise<void> {
  const { activeAccountIndex, profiles, cocoMigrationComplete } = useProfileStore.getState();
  await AsyncStorage.setItem(
    'profile-store',
    JSON.stringify({
      state: { activeAccountIndex, profiles, cocoMigrationComplete },
      version: 0,
    })
  );
}

async function teardownAndRestart(): Promise<boolean> {
  usePopupStore.getState().destroySheet();
  usePaymentStatusStore.getState().setActive(null);

  const restarted = await restartApp();
  if (!restarted) {
    console.error('[ProfileOrchestrator] Restart failed — app will rely on React key remount');
  }
  return restarted;
}

// ── Public API ───────────────────────────────────────────────────

export async function switchToExistingProfile(opts: {
  accountIndex: number;
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  const resetStages = opts.resetStages ?? registeredControls?.resetStages;
  const cancelResetStages = opts.cancelResetStages ?? registeredControls?.cancelResetStages;

  if (!(await beginTransition())) return false;
  try {
    resetStages?.({ holdUntilCancel: true });
    usePopupStore.getState().close();

    await CocoManager.cleanup();

    const switched = useProfileStore.getState().switchProfile(opts.accountIndex);
    if (!switched) {
      throw new Error(`Target profile does not exist: ${opts.accountIndex}`);
    }

    await flushProfileStoreToDisk();
    const restarted = await teardownAndRestart();
    if (!restarted) cancelResetStages?.();
    return true;
  } catch (error) {
    console.error('[ProfileOrchestrator] switch failed:', error);
    cancelResetStages?.();
    return false;
  } finally {
    await endTransition();
  }
}

export async function createAndSwitchProfile(opts?: {
  getKeysForAccount?: KeyDerivationFn;
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  const getKeysForAccount = opts?.getKeysForAccount ?? registeredKeyDerivation;
  const resetStages = opts?.resetStages ?? registeredControls?.resetStages;
  const cancelResetStages = opts?.cancelResetStages ?? registeredControls?.cancelResetStages;

  if (!getKeysForAccount) {
    console.error('[ProfileOrchestrator] No key derivation function registered');
    return false;
  }

  if (!(await beginTransition())) return false;
  try {
    resetStages?.({ holdUntilCancel: true });
    usePopupStore.getState().close();

    const profileStore = useProfileStore.getState();
    const nextIndex = profileStore.getNextAccountIndex();
    const newKeys = await getKeysForAccount(nextIndex);
    if (!newKeys?.pubkey) {
      console.warn('[ProfileOrchestrator] Failed to derive keys for new profile');
      cancelResetStages?.();
      return false;
    }

    profileStore.addProfile(nextIndex, newKeys.pubkey);

    await CocoManager.cleanup();
    const switched = useProfileStore.getState().switchProfile(nextIndex);
    if (!switched) {
      throw new Error(`Failed to activate newly-created profile: ${nextIndex}`);
    }

    await flushProfileStoreToDisk();
    const restarted = await teardownAndRestart();
    if (!restarted) cancelResetStages?.();
    return true;
  } catch (error) {
    console.error('[ProfileOrchestrator] create failed:', error);
    cancelResetStages?.();
    return false;
  } finally {
    await endTransition();
  }
}

export async function switchToImportedProfile(opts: {
  accountIndex: number;
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  return switchToExistingProfile(opts);
}

/**
 * Nuclear wipe — delete ALL app data and restart fresh.
 * Clears: all Zustand stores, all AsyncStorage, all SecureStore keys,
 * all SQLite databases, all Redux state. Nothing survives.
 */
export async function deleteAllProfiles(opts?: {
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  const resetStages = opts?.resetStages ?? registeredControls?.resetStages;
  const cancelResetStages = opts?.cancelResetStages ?? registeredControls?.cancelResetStages;

  if (!(await beginTransition())) return false;
  try {
    resetStages?.({ holdUntilCancel: true });
    usePopupStore.getState().close();

    const profiles = useProfileStore.getState().profiles;
    const accountIndexes = profiles.map((p) => p.accountIndex);
    const importedPubkeys = profiles.filter((p) => p.source === 'imported').map((p) => p.pubkey);

    // 1. Close SQLite and destroy all Coco databases
    try {
      await CocoManager.completeReset(accountIndexes);
    } catch (e) {
      console.warn('[ProfileOrchestrator] Coco completeReset failed:', e);
    }

    // 2. Clear ALL secure storage (mnemonic, derived keys, cashu mnemonics, imported nsecs)
    try {
      const { clearAllSecureData } = await import('@/shared/lib/nostr/secureStorage');
      await clearAllSecureData(accountIndexes, importedPubkeys);
    } catch (e) {
      console.warn('[ProfileOrchestrator] clearAllSecureData failed:', e);
    }

    // 3. Nuclear AsyncStorage wipe — every key, every store, everything
    try {
      await AsyncStorage.clear();
    } catch (e) {
      console.warn('[ProfileOrchestrator] AsyncStorage.clear() failed:', e);
    }

    // 4. Purge Redux persisted state
    try {
      const { persistor } = await import('@/redux/store/store.deprecated');
      await persistor.purge();
    } catch (e) {
      console.warn('[ProfileOrchestrator] Redux persistor.purge() failed:', e);
    }

    // 5. Clear all Zustand in-memory state so nothing bleeds before restart
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: [],
      cocoMigrationComplete: {},
    });

    const restarted = await teardownAndRestart();
    if (!restarted) {
      cancelResetStages?.();
      const { Alert } = await import('react-native');
      Alert.alert('Restart Required', 'Please close and reopen the app to complete the reset.', [
        { text: 'OK' },
      ]);
    }
    return true;
  } catch (error) {
    console.error('[ProfileOrchestrator] delete all profiles failed:', error);
    cancelResetStages?.();
    return false;
  } finally {
    await endTransition();
  }
}
