/**
 * Which accounts' wallet databases this install has opened, and what to do
 * when one of them is gone.
 *
 * A wallet database that is missing is opened as a new, empty one. For an
 * account that has never been opened here that is correct. For one that has,
 * the ecash it held is no longer on the device and only a restore from the
 * mints brings it back, so the person is asked for one instead of being shown
 * an empty wallet.
 *
 * The record is `walletDatabaseCreated` on the account's row in the profile
 * list, so it goes when the row goes. A row without it (every row written by
 * 0.1.3 or earlier, and every new row) never asks for a restore; it is recorded
 * the first time its database is opened. Accounts are not recorded in the
 * background: a late save of the profile list could put back the active account
 * a switch had just changed on disk.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { cashuLog } from '../logger';
import {
  PROFILE_STORE_PERSIST_VERSION,
  useProfileStore,
} from '@/shared/stores/global/profileStore';
import { useWalletLifecycleStore } from '@/shared/stores/global/walletLifecycleStore';

const isRecorded = (accountIndex: number): boolean =>
  useProfileStore.getState().profiles.find((p) => p.accountIndex === accountIndex)
    ?.walletDatabaseCreated === true;

/**
 * Call when an account's database has been opened and before anything is
 * written to it. `wasEmpty` is whether it held no tables.
 *
 * The restore status is one value for the whole install, not one per account.
 * Marking it pending holds the app on the restore screen, and the restore that
 * screen runs is for the wallet that is open: the account that lost its
 * database. Other accounts are not touched, but none can be used until it ends.
 */
export function askForRestoreIfWalletDatabaseLost(accountIndex: number, wasEmpty: boolean): void {
  if (!wasEmpty || !isRecorded(accountIndex)) return;
  cashuLog.warn('cashu.wallet_database.lost', { accountIndex });
  const ask = () => {
    const { restoreStatus, setRestoreStatus } = useWalletLifecycleStore.getState();
    if (restoreStatus !== 'pending' && restoreStatus !== 'failed') setRestoreStatus('pending');
  };
  const { persist } = useWalletLifecycleStore;
  if (persist.hasHydrated()) {
    ask();
    return;
  }
  // Loading the saved status afterwards would put `complete` back over it.
  const stop = persist.onFinishHydration(() => {
    stop();
    ask();
  });
}

/** Call once an account's database has been opened and migrated. */
export function recordWalletDatabaseCreated(accountIndex: number): void {
  useProfileStore.getState().setWalletDatabaseCreated([accountIndex], true);
}

/** Whether the profile list on disk no longer records a database for any of these accounts. */
async function savedAsForgotten(accountIndexes: readonly number[]): Promise<boolean> {
  const raw = await AsyncStorage.getItem('profile-store');
  if (raw === null) return true;
  const saved = JSON.parse(raw) as {
    state?: { profiles?: { accountIndex?: number; walletDatabaseCreated?: unknown }[] };
  };
  return !(saved.state?.profiles ?? []).some(
    (profile) =>
      profile.walletDatabaseCreated === true &&
      profile.accountIndex !== undefined &&
      accountIndexes.includes(profile.accountIndex)
  );
}

/**
 * Call, and wait for, before deleting these accounts' databases on purpose.
 *
 * The store saves on its own and does not say whether the save landed. If it
 * did not and the deletion is interrupted, the next launch finds a recorded
 * database missing and asks for a restore of an account the person removed.
 * So this writes the profile list itself, reads it back, and resolves only
 * once the list on disk has forgotten them. It rejects when the write or the
 * read fails or does not answer within `waitMs`: the caller must not delete
 * anything then, and may call again.
 */
export async function forgetWalletDatabases(
  accountIndexes: readonly number[],
  waitMs = 2000
): Promise<void> {
  // A list that did not load is defaults in memory. Writing it would replace
  // the saved one, which the store itself is guarded against doing.
  if (!useProfileStore.persist.hasHydrated()) {
    cashuLog.warn('cashu.wallet_database.forget_not_saved', { reason: 'profile-list-not-loaded' });
    throw new Error('The wallet database record could not be saved');
  }
  useProfileStore.getState().setWalletDatabaseCreated(accountIndexes, false);
  const { activeAccountIndex, profiles } = useProfileStore.getState();
  const row = JSON.stringify({
    state: { activeAccountIndex, profiles },
    version: PROFILE_STORE_PERSIST_VERSION,
  });
  const confirmed = (async () => {
    await AsyncStorage.setItem('profile-store', row);
    return savedAsForgotten(accountIndexes);
  })().catch(() => false);
  const saved = await Promise.race([
    confirmed,
    new Promise<false>((resolve) => setTimeout(() => resolve(false), waitMs)),
  ]);
  if (!saved) {
    cashuLog.warn('cashu.wallet_database.forget_not_saved', { accountIndexes });
    throw new Error('The wallet database record could not be saved');
  }
}
