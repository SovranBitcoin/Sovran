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
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { storeMnemonic, prepareSecureDataReset } from '@/shared/lib/nostr/secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { log, nostrLog, redactError } from '../logger';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { deriveNostrKeys } from '@/shared/lib/nostr/keyDerivation';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { clearAllQueryCaches } from '@/shared/lib/cache/createQueryCacheStore';
import { resetRoutstrClient } from '@/shared/lib/routstr/sdk/client';
import { usePopupStore } from '@/shared/stores/runtime/popupStore';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useBTCMapStore } from '@/shared/stores/global/btcMapStore';

import {
  acquireTransition,
  activateProfileInMemory,
  cleanupCocoWithTimeout,
  isTransitionInFlight,
  keyDerivation,
  persistSwitchTargetToDisk,
  splashControls,
  teardownAndRestart,
  type KeyDerivationFn,
  type TransitionControls,
} from './profileTransition';
import {
  runInProcessProfileSwitch,
  checkProfileSwitchLeaks,
  holdProfileSwitchForRestart,
  switchStep,
} from './inProcessProfileSwitch';

// ── Public API ───────────────────────────────────────────────────

export async function switchToExistingProfile(opts: {
  accountIndex: number;
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  if (isTransitionInFlight()) {
    log.warn('profile.orchestrator.switch_blocked_in_flight');
    return false;
  }
  if (!CocoManager.isReadyForCleanup()) {
    // Log the full component breakdown so a "switch did nothing" report says
    // WHICH condition blocked it (BTC-14).
    log.warn('profile.orchestrator.switch_blocked_coco_not_ready', {
      ...CocoManager.getCleanupReadiness(),
    });
    return false;
  }
  const lock = acquireTransition();
  if (!lock) return false;
  if (!(await lock.takeDiskGuard())) {
    await lock.release();
    return false;
  }
  try {
    log.info('profile.orchestrator.switch_start', { accountIndex: opts.accountIndex });
    // Without a restart, a stage owned above the account providers never
    // registers again, so it must survive the reset or its dependents never start.
    lock.holdSplash(splashControls(opts), {
      holdUntilCancel: true,
      keepStagesThatOutliveAccount: useSettingsStore.getState().inProcessProfileSwitch,
    });
    usePopupStore.getState().close();

    // Validate the target up front — the same existence check
    // profileStore.switchProfile performs, done before any teardown.
    const targetExists = useProfileStore
      .getState()
      .profiles.some((p) => p.accountIndex === opts.accountIndex);
    if (!targetExists) {
      throw new Error(`Target profile does not exist: ${opts.accountIndex}`);
    }

    const release = () => lock.release();
    return useSettingsStore.getState().inProcessProfileSwitch
      ? await switchWithoutRestart(opts.accountIndex, release)
      : await switchByRestart(opts.accountIndex, release);
  } catch (error) {
    log.error('profile.orchestrator.switch_failed', { error: redactError(error) });
    await lock.release();
    return false;
  }
}

/**
 * The opt-in switch: stop the old account and start the new one in the same
 * runtime. On any failure it holds the account providers down and restarts,
 * so a half-switched wallet is never mounted.
 */
async function switchWithoutRestart(
  accountIndex: number,
  release: () => Promise<void>
): Promise<boolean> {
  const previousIndex = useProfileStore.getState().activeAccountIndex;
  const previousPubkey = useProfileStore.getState().getActiveProfile()?.pubkey;
  try {
    await runInProcessProfileSwitch({
      cleanupCoco: () => CocoManager.cleanup({ requireSuccess: true }),
      flipAccount: async () => {
        activateProfileInMemory(accountIndex);
        const persisted = await persistSwitchTargetToDisk(accountIndex);
        if (persisted.isErr()) throw persisted.error;
      },
    });
    await release();
    if (previousPubkey) {
      void checkProfileSwitchLeaks(previousPubkey).catch((error) => {
        log.warn('profile.switch.leak_check_failed', { error: redactError(error) });
      });
    }
    return true;
  } catch (error) {
    // The reason is the only way to learn why a switch fell back.
    log.warn('profile.switch.in_process_failed', { error: redactError(error) });
    await holdProfileSwitchForRestart().catch(() => {
      log.warn('profile.switch.boundary_hold_failed');
    });
    // Restore the active identity before restarting; never mount a partial B session.
    activateProfileInMemory(previousIndex);
    log.warn('profile.switch.restart_fallback');
    try {
      const persisted = await switchStep(() => persistSwitchTargetToDisk(accountIndex));
      if (persisted.isErr()) log.warn('profile.switch.restart_target_failed');
    } catch {
      log.warn('profile.switch.restart_target_failed');
    }
    // Holding the boundary unmounts the wallet provider, which starts a
    // cleanup nobody awaits. Wait for the wallet database to close, as the
    // restart path does, before the runtime is torn down.
    await cleanupCocoWithTimeout();
    // If restart is unavailable, keep the held boundary and write barrier.
    // Resuming after failed teardown would expose a half-switched wallet.
    return await teardownAndRestart();
  }
}

/** The default switch: close the wallet, record the target on disk, restart into it. */
async function switchByRestart(
  accountIndex: number,
  release: () => Promise<void>
): Promise<boolean> {
  await cleanupCocoWithTimeout();

  // The Routstr client holds a hydrated, profile-scoped store and a wallet
  // adapter bound to the Coco manager just torn down. A restart discards it
  // anyway; this covers the in-process fallback below, where the module
  // survives and would otherwise spend the new profile's wallet against the
  // old profile's provider state.
  resetRoutstrClient();

  // Persist the switch target and restart into it WITHOUT the in-memory
  // store flip — the flip remounts the whole provider tree and would boot
  // the new profile in-process, racing the native restart (BTC-13).
  const persisted = await persistSwitchTargetToDisk(accountIndex);
  if (persisted.isErr()) {
    throw persisted.error;
  }
  const restarted = await teardownAndRestart();
  if (!restarted) {
    // Restart unavailable: complete the switch in-process — the remount
    // boots the new profile, the only boot in this configuration.
    useProfileStore.getState().switchProfile(accountIndex);
    await release();
  }
  // If restarted, leave transitionInFlight=true — the module is about to reload.
  return true;
}

export async function createAndSwitchProfile(opts?: {
  getKeysForAccount?: KeyDerivationFn;
  resetStages?: TransitionControls['resetStages'];
  cancelResetStages?: TransitionControls['cancelResetStages'];
}): Promise<boolean> {
  const getKeysForAccount = opts?.getKeysForAccount ?? keyDerivation();

  const lock = acquireTransition();
  if (!lock) return false;

  if (!getKeysForAccount) {
    log.error('profile.orchestrator.no_key_derivation');
    await lock.release();
    return false;
  }

  if (!(await lock.takeDiskGuard())) {
    await lock.release();
    return false;
  }
  try {
    lock.holdSplash(splashControls(opts), { holdUntilCancel: true });
    usePopupStore.getState().close();

    const profileStore = useProfileStore.getState();
    const nextIndex = profileStore.getNextAccountIndex();
    const newKeys = await getKeysForAccount(nextIndex);
    if (!newKeys?.pubkey) {
      log.warn('profile.orchestrator.key_derivation_failed');
      await lock.release();
      return false;
    }

    // Not fire-and-forget: at `MAX_PROFILES` the store refuses, and switching
    // into an index it does not hold would leave the app running as an account
    // nothing knows about — profile-scoped storage included.
    if (!profileStore.addProfile(nextIndex, newKeys.pubkey)) {
      log.warn('profile.orchestrator.at_capacity', { nextIndex });
      await lock.release();
      return false;
    }

    await cleanupCocoWithTimeout();
    // Persist-then-restart without the in-memory flip (BTC-13 — see
    // switchToExistingProfile); the flip is the failed-restart fallback.
    const persisted = await persistSwitchTargetToDisk(nextIndex);
    if (persisted.isErr()) {
      throw persisted.error;
    }
    const restarted = await teardownAndRestart();
    if (!restarted) {
      const switched = useProfileStore.getState().switchProfile(nextIndex);
      if (!switched) {
        throw new Error(`Failed to activate newly-created profile: ${nextIndex}`);
      }
      await lock.release();
    }
    return true;
  } catch (error) {
    log.error('profile.orchestrator.create_failed', { error: redactError(error) });
    await lock.release();
    return false;
  }
}

/** Replace an inaccessible root, or the unused onboarding root, then boot new caches. */
export async function recoverMnemonicSession(mnemonic: string): Promise<boolean> {
  if (!bip39.validateMnemonic(mnemonic, wordlist) || mnemonic.split(' ').length !== 12)
    return false;
  // Recovery runs before any account is usable, so there is no splash to hold
  // and no earlier runtime's transition to wait out: the in-memory lock only.
  const lock = acquireTransition();
  if (!lock) return false;
  try {
    const locked = useSecureStoreState.getState().secureStoreState === 'locked';
    const onboarding = !locked && !useSettingsStore.getState().hasSeenOnboarding;
    if (
      !onboarding &&
      !locked &&
      !useProfileStore.getState().profiles.some((p) => p.source !== 'imported')
    )
      return false;
    if (
      !onboarding &&
      useProfileStore
        .getState()
        .profiles.some(
          (profile) =>
            profile.source !== 'imported' &&
            deriveNostrKeys(mnemonic, profile.accountIndex).pubkey !== profile.pubkey
        )
    )
      return false;
    await CocoManager.cleanup();

    // Persist before restart without changing the current account scope mid-flight.
    const lifecycle = useWalletLifecycleStore.persist.getOptions();
    await lifecycle.storage!.setItem(lifecycle.name!, {
      version: lifecycle.version,
      state: {
        seedCreatedAt: null,
        recoveryPhraseVerifiedAt: null,
        recoveryPhraseVerifiedRevision: null,
        restoreStatus: 'pending',
        lastRestoreAt: null,
        lastRestoreError: null,
      },
    });
    if (onboarding) {
      // The carousel's auto-generated account is disposable. Its row must not
      // point at the new mnemonic on restart; no wallet operation is available here.
      const profiles = useProfileStore.persist.getOptions();
      await profiles.storage!.setItem(profiles.name!, {
        version: profiles.version,
        state: { activeAccountIndex: 0, profiles: [] },
      });
    }
    if (!(await storeMnemonic(mnemonic))) return false;
    const settings = useSettingsStore.persist.getOptions();
    await settings.storage!.setItem(settings.name!, {
      version: settings.version,
      state: { ...settings.partialize!(useSettingsStore.getState()), hasSeenOnboarding: true },
    });
    nostrLog.info('secure.mnemonic.recovered');
    return restartApp();
  } catch {
    nostrLog.warn('secure.mnemonic.recovery_failed');
    return false;
  } finally {
    await lock.release();
  }
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
  const lock = acquireTransition();
  if (!lock) return false;
  if (!(await lock.takeDiskGuard())) {
    await lock.release();
    return false;
  }
  try {
    lock.holdSplash(splashControls(opts), { holdUntilCancel: true });
    usePopupStore.getState().close();

    const profiles = useProfileStore.getState().profiles;
    const accountIndexes = Array.from(new Set([0, ...profiles.map((p) => p.accountIndex)]));
    const importedPubkeys = profiles.filter((p) => p.source === 'imported').map((p) => p.pubkey);

    const clearSecureData = await prepareSecureDataReset(accountIndexes, importedPubkeys);

    // 1. Close SQLite and destroy all Coco databases
    await CocoManager.completeReset(accountIndexes);

    // 2. Clear ALL secure storage (mnemonic, derived keys, cashu mnemonics, imported nsecs)
    if (!(await clearSecureData())) {
      throw new Error('Secure data reset incomplete');
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

    // 3b. Nuclear AsyncStorage wipe — every key, every store, everything.
    // Query caches first, so an in-flight read that completes after this
    // point is rejected by its generation guard instead of re-writing a key.
    clearAllQueryCaches();
    await AsyncStorage.clear();

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
      await lock.release();
      const { Alert } = await import('react-native');
      Alert.alert('Restart Required', 'Please close and reopen the app to complete the reset.', [
        { text: 'OK' },
      ]);
    }
    return true;
  } catch (error) {
    log.error('profile.orchestrator.delete_all_failed', { error: redactError(error) });
    await lock.release();
    return false;
  }
}

/** Single-profile removal shares admission with every account transition. */
export async function removeInactiveProfile(accountIndex: number, importedKeyConfirmed = false) {
  // The removed profile is not running, so nothing is torn down and no splash
  // is shown; both guards still keep a switch from starting underneath it.
  const lock = acquireTransition();
  if (!lock) return { kind: 'refused', reason: 'busy' } as const;
  try {
    if (!useProfileStore.persist.hasHydrated())
      return { kind: 'refused', reason: 'unreadable' } as const;
    if (!(await lock.takeDiskGuard())) return { kind: 'refused', reason: 'busy' } as const;
    const { removeProfileData } = await import('./removeProfile');
    const { profileRemovalPorts } = await import('./profileRemovalStorage');
    return await removeProfileData(accountIndex, importedKeyConfirmed, profileRemovalPorts);
  } catch {
    // Module/native initialization errors can carry sensitive context; disclose no records.
    return { kind: 'refused', reason: 'unreadable' } as const;
  } finally {
    await lock.release();
  }
}
