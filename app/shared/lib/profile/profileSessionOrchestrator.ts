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

import { log, redactError } from '../logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import {
  PROFILE_STORE_PERSIST_VERSION,
  useProfileStore,
} from '@/shared/stores/global/profileStore';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';

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
      log.warn('profile.orchestrator.stale_guard');
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
  const { activeAccountIndex, profiles } = useProfileStore.getState();
  await AsyncStorage.setItem(
    'profile-store',
    JSON.stringify({
      state: { activeAccountIndex, profiles },
      version: PROFILE_STORE_PERSIST_VERSION,
    })
  );
}

async function teardownAndRestart(): Promise<boolean> {
  usePopupStore.getState().destroySheet();
  usePaymentStatusStore.getState().setActive(null);

  const restarted = await restartApp();
  if (!restarted) {
    log.error('profile.orchestrator.restart_failed');
  }
  return restarted;
}

// ── Synchronous in-memory guard (supplements the async AsyncStorage guard) ──
let transitionInFlight = false;

// ── Public API ───────────────────────────────────────────────────

export async function switchToExistingProfile(opts: {
  accountIndex: number;
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  if (transitionInFlight) {
    log.warn('profile.orchestrator.switch_blocked_in_flight');
    return false;
  }
  if (!CocoManager.isReadyForCleanup()) {
    log.warn('profile.orchestrator.switch_blocked_coco_not_ready', {
      isInitialized: CocoManager.isInitialized(),
    });
    return false;
  }
  transitionInFlight = true;

  const resetStages = opts.resetStages ?? registeredControls?.resetStages;
  const cancelResetStages = opts.cancelResetStages ?? registeredControls?.cancelResetStages;

  if (!(await beginTransition())) {
    transitionInFlight = false;
    return false;
  }
  try {
    log.info('profile.orchestrator.switch_start', { accountIndex: opts.accountIndex });
    resetStages?.({ holdUntilCancel: true });
    usePopupStore.getState().close();

    await CocoManager.cleanup();

    const switched = useProfileStore.getState().switchProfile(opts.accountIndex);
    if (!switched) {
      throw new Error(`Target profile does not exist: ${opts.accountIndex}`);
    }

    await flushProfileStoreToDisk();
    const restarted = await teardownAndRestart();
    if (!restarted) {
      cancelResetStages?.();
      transitionInFlight = false;
      await endTransition();
    }
    // If restarted, leave transitionInFlight=true — the module is about to reload.
    return true;
  } catch (error) {
    log.error('profile.orchestrator.switch_failed', { error: redactError(error) });
    cancelResetStages?.();
    transitionInFlight = false;
    await endTransition();
    return false;
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

  if (transitionInFlight) return false;
  transitionInFlight = true;

  if (!getKeysForAccount) {
    log.error('profile.orchestrator.no_key_derivation');
    transitionInFlight = false;
    return false;
  }

  if (!(await beginTransition())) {
    transitionInFlight = false;
    return false;
  }
  try {
    resetStages?.({ holdUntilCancel: true });
    usePopupStore.getState().close();

    const profileStore = useProfileStore.getState();
    const nextIndex = profileStore.getNextAccountIndex();
    const newKeys = await getKeysForAccount(nextIndex);
    if (!newKeys?.pubkey) {
      log.warn('profile.orchestrator.key_derivation_failed');
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
    if (!restarted) {
      cancelResetStages?.();
      transitionInFlight = false;
      await endTransition();
    }
    return true;
  } catch (error) {
    log.error('profile.orchestrator.create_failed', { error: redactError(error) });
    cancelResetStages?.();
    transitionInFlight = false;
    await endTransition();
    return false;
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
 * all SQLite databases. Nothing survives.
 */
export async function deleteAllProfiles(opts?: {
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  const resetStages = opts?.resetStages ?? registeredControls?.resetStages;
  const cancelResetStages = opts?.cancelResetStages ?? registeredControls?.cancelResetStages;

  if (transitionInFlight) return false;
  transitionInFlight = true;

  if (!(await beginTransition())) {
    transitionInFlight = false;
    return false;
  }
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
      log.warn('profile.orchestrator.coco_reset_failed', { error: redactError(e) });
    }

    // 2. Clear ALL secure storage (mnemonic, derived keys, cashu mnemonics, imported nsecs)
    try {
      const { clearAllSecureData } = await import('@/shared/lib/nostr/secureStorage');
      await clearAllSecureData(accountIndexes, importedPubkeys);
    } catch (e) {
      log.warn('profile.orchestrator.clear_secure_data_failed', { error: redactError(e) });
    }

    // 3a. Per-feature wipes BEFORE the nuclear AsyncStorage.clear() so any
    // namespace that later migrates off AsyncStorage (SQLite, SecureStore, …)
    // still gets cleaned up. AsyncStorage.clear() then catches anything we
    // missed.
    try {
      const { wipeWhitenoiseStorageForAccounts } = await import('@/features/whitenoise/storage');
      await wipeWhitenoiseStorageForAccounts(accountIndexes);
    } catch (e) {
      log.warn('profile.orchestrator.wipe_whitenoise_failed', { error: redactError(e) });
    }

    // 3b. Nuclear AsyncStorage wipe — every key, every store, everything
    try {
      await AsyncStorage.clear();
    } catch (e) {
      log.warn('profile.orchestrator.async_storage_clear_failed', { error: redactError(e) });
    }

    // 4. Clear all Zustand in-memory state so nothing bleeds before restart
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: [],
    });
    // btcMapStore holds an in-flight 2–3s places fetch that would otherwise
    // resolve between AsyncStorage.clear() above and restartApp() below,
    // re-populating cleared storage with stale data. reset() bumps an epoch
    // the in-flight closure rechecks before commit.
    useBTCMapStore.getState().reset();

    const restarted = await teardownAndRestart();
    if (!restarted) {
      cancelResetStages?.();
      transitionInFlight = false;
      await endTransition();
      const { Alert } = await import('react-native');
      Alert.alert('Restart Required', 'Please close and reopen the app to complete the reset.', [
        { text: 'OK' },
      ]);
    }
    return true;
  } catch (error) {
    log.error('profile.orchestrator.delete_all_failed', { error: redactError(error) });
    cancelResetStages?.();
    transitionInFlight = false;
    await endTransition();
    return false;
  }
}
