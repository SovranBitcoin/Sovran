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
import {
  storeImportedNsec,
  storeMnemonic,
  prepareSecureDataReset,
} from '@/shared/lib/nostr/secureStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

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
  settleWithin,
  splashControls,
  teardownAndRestart,
  TIMED_OUT,
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

/** Key derivation is slow on old phones; this is a ceiling, not an expectation. */
const KEY_DERIVATION_TIMEOUT_MS = 30_000;
const WALLET_CLOSE_TIMEOUT_MS = 10_000;

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
      : await restartInto(opts.accountIndex);
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

/**
 * The shared ending of the default switch and of add-profile: ask the wallet
 * to close, record the target on disk, restart into it. (The in-process switch
 * has its own fallback.)
 *
 * Asking the wallet to close is the point of no return. Before it, a flow that
 * fails gives up and releases the lock, and the app carries on as it was. From
 * it on, the old account can no longer be relied on (its wallet is closed or
 * closing), so there are only two endings and neither releases the lock:
 *
 * - the restart happens, and the new runtime starts as whichever account is
 *   on disk;
 * - anything else, and the app is held until it is reopened.
 *
 * The active account is never flipped in memory here. That flip remounts the
 * provider tree over stores still holding the old account's state.
 *
 * Resolves true when the write of the target was acknowledged, false when it
 * was not; the app is then held, and reopening starts as whatever is on disk.
 */
async function restartInto(accountIndex: number): Promise<boolean> {
  await cleanupCocoWithTimeout();
  // The Routstr client holds a store and a wallet adapter bound to the wallet
  // just closed. A restart discards it; this covers a restart that does not happen.
  resetRoutstrClient();

  let recorded = false;
  try {
    const persisted = await persistSwitchTargetToDisk(accountIndex);
    if (persisted.isErr()) throw persisted.error;
    recorded = true;
    if (await teardownAndRestart()) return true;
  } catch (error) {
    log.error('profile.orchestrator.restart_into_failed', {
      recorded,
      error: redactError(error),
    });
  }
  await holdUntilReopened(
    recorded
      ? 'Please close and reopen the app to finish switching profiles.'
      : 'Could not switch profiles. Please close and reopen the app.'
  );
  return recorded;
}

/**
 * Hold the app until it is reopened: account providers unmounted, per-profile
 * saves blocked, the splash and the lock kept, and an alert saying so. Nothing
 * may run as either account once the wallet has been closed for a switch.
 */
async function holdUntilReopened(message: string): Promise<void> {
  await holdProfileSwitchForRestart().catch(() => {
    log.warn('profile.switch.boundary_hold_failed');
  });
  Alert.alert('Restart Required', message, [{ text: 'OK' }]);
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
    lock.holdSplash(splashControls(opts));
    usePopupStore.getState().close();

    const profileStore = useProfileStore.getState();
    const nextIndex = profileStore.getNextAccountIndex();
    // Bounded: a derivation that never settles would hold the lock for good.
    // Finishing late is harmless, it only stores keys for an index not in use.
    const derived = await settleWithin(getKeysForAccount(nextIndex), KEY_DERIVATION_TIMEOUT_MS);
    const newKeys = derived === TIMED_OUT ? null : derived;
    if (!newKeys?.pubkey) {
      log.warn('profile.orchestrator.key_derivation_failed', { timedOut: derived === TIMED_OUT });
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

    return await restartInto(nextIndex);
  } catch (error) {
    log.error('profile.orchestrator.create_failed', { error: redactError(error) });
    await lock.release();
    return false;
  }
}

type ImportProfileResult =
  /** The key is stored, the profile added, and the app is restarting into it (or held). */
  | 'switching'
  /** A profile with this identity already exists. Nothing was changed. */
  | 'exists'
  /** Another account flow is running, or the wallet is not idle. Nothing was changed. */
  | 'busy'
  /** Secure storage refused the key. Nothing was changed. */
  | 'key-not-stored'
  /** The profile list is full. The key was stored, and nothing else changed. */
  | 'limit';

/**
 * Add a profile from an imported key and switch to it.
 *
 * Storing the key and adding the profile row happen under the same lock as the
 * switch that follows, so no other account flow can run between them.
 */
export async function importAndSwitchProfile(opts: {
  accountIndex: number;
  pubkeyHex: string;
  nsec: string;
}): Promise<ImportProfileResult> {
  if (useProfileStore.getState().hasPubkey(opts.pubkeyHex)) return 'exists';
  if (isTransitionInFlight() || !CocoManager.isReadyForCleanup()) {
    log.warn('profile.orchestrator.import_blocked', { ...CocoManager.getCleanupReadiness() });
    return 'busy';
  }
  const lock = acquireTransition();
  if (!lock) return 'busy';
  if (!(await lock.takeDiskGuard())) {
    await lock.release();
    return 'busy';
  }
  try {
    const inProcess = useSettingsStore.getState().inProcessProfileSwitch;
    lock.holdSplash(splashControls(), { keepStagesThatOutliveAccount: inProcess });
    usePopupStore.getState().close();

    if (!(await storeImportedNsec(opts.pubkeyHex, opts.nsec))) {
      await lock.release();
      return 'key-not-stored';
    }
    if (!useProfileStore.getState().addProfile(opts.accountIndex, opts.pubkeyHex, 'imported')) {
      log.warn('profile.orchestrator.at_capacity', { nextIndex: opts.accountIndex });
      await lock.release();
      return 'limit';
    }
    // From here on the endings are the switch's own: a restart or a hold.
    if (inProcess) await switchWithoutRestart(opts.accountIndex, () => lock.release());
    else await restartInto(opts.accountIndex);
    return 'switching';
  } catch (error) {
    log.error('profile.orchestrator.import_failed', { error: redactError(error) });
    await lock.release();
    return 'busy';
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
  let held = false;
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
    // Bounded, and refused on a timeout: the phrase must not be replaced while
    // the wallet opened under the old one may still be writing.
    if ((await settleWithin(CocoManager.cleanup(), WALLET_CLOSE_TIMEOUT_MS)) === TIMED_OUT) {
      log.warn('profile.orchestrator.recovery_cleanup_timeout');
      return false;
    }

    // Two steps, with the phrase as the point of no return between them.
    //
    // 1. Prepare: record that a restore is owed and, during onboarding, drop
    //    the throwaway profile. Written before the phrase so a restart can
    //    never find the new phrase without the restore decision. If the phrase
    //    then cannot be stored, both are put back as they were.
    const lifecycle = useWalletLifecycleStore.persist.getOptions();
    const profiles = useProfileStore.persist.getOptions();
    // A record that cannot be read (damaged JSON) must not stop a recovery:
    // it is simply not something that can be put back.
    type Saved = { readable: true; value: unknown } | { readable: false };
    const read = async (options: typeof lifecycle | typeof profiles): Promise<Saved> => {
      try {
        return { readable: true, value: await options.storage!.getItem(options.name!) };
      } catch {
        return { readable: false };
      }
    };
    const restore = async (options: typeof lifecycle | typeof profiles, previous: Saved) => {
      if (!previous.readable) return;
      if (previous.value) await options.storage!.setItem(options.name!, previous.value as never);
      else await options.storage!.removeItem(options.name!);
    };
    const before = {
      lifecycle: await read(lifecycle),
      profiles: onboarding ? await read(profiles) : ({ readable: false } as Saved),
    };
    const putBack = async () => {
      await restore(lifecycle, before.lifecycle);
      await restore(profiles, before.profiles);
    };
    let phraseStored = false;
    try {
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
        await profiles.storage!.setItem(profiles.name!, {
          version: profiles.version,
          state: { activeAccountIndex: 0, profiles: [] },
        });
      }
      phraseStored = await storeMnemonic(mnemonic);
    } finally {
      if (!phraseStored) {
        await putBack().catch(() => nostrLog.warn('secure.mnemonic.recovery_rollback_failed'));
      }
    }
    if (!phraseStored) return false;

    // 2. The phrase is replaced. This runtime still holds keys from the old
    //    one, so the only endings are a restart or a hold.
    try {
      const settings = useSettingsStore.persist.getOptions();
      await settings.storage!.setItem(settings.name!, {
        version: settings.version,
        state: { ...settings.partialize!(useSettingsStore.getState()), hasSeenOnboarding: true },
      });
      nostrLog.info('secure.mnemonic.recovered');
      if (restartApp()) return true;
    } catch (error) {
      log.error('profile.orchestrator.recovery_finish_failed', { error: redactError(error) });
    }
    held = true;
    await holdUntilReopened('Your recovery phrase is saved. Please close and reopen the app.');
    return true;
  } catch {
    nostrLog.warn('secure.mnemonic.recovery_failed');
    return false;
  } finally {
    if (!held) await lock.release();
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
  // Set once the first irreversible deletion starts.
  let erasing = false;
  try {
    lock.holdSplash(splashControls(opts));
    usePopupStore.getState().close();

    const profiles = useProfileStore.getState().profiles;
    const accountIndexes = Array.from(new Set([0, ...profiles.map((p) => p.accountIndex)]));
    const importedPubkeys = profiles.filter((p) => p.source === 'imported').map((p) => p.pubkey);

    const clearSecureData = await prepareSecureDataReset(accountIndexes, importedPubkeys);

    // 1. Close SQLite and destroy all Coco databases
    erasing = true;
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

    // The Nostr cache databases are named by account index, like the wallet
    // ones. Left behind, the next identity created at index 0 would open the
    // deleted identity's cache.
    try {
      const { deleteNostrCaches } = await import('./profileRemovalStorage');
      await deleteNostrCaches(accountIndexes);
    } catch (e) {
      log.warn('profile.orchestrator.wipe_nostr_cache_failed', { error: redactError(e) });
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

    if (!(await teardownAndRestart())) {
      await holdUntilReopened('Please close and reopen the app to complete the reset.');
    }
    return true;
  } catch (error) {
    log.error('profile.orchestrator.delete_all_failed', { erasing, error: redactError(error) });
    if (!erasing) {
      await lock.release();
      return false;
    }
    // Part of the installation is gone. The account providers must not come
    // back over it, so the lock is kept and the app waits to be reopened.
    await holdUntilReopened(
      'The reset did not finish. Please close and reopen the app, then try again.'
    );
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
