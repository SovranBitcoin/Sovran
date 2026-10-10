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
import { cashuLog } from '../logger';
import { useProfileStore } from '@/shared/stores/global/profileStore';
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

/** Call before deleting these accounts' databases on purpose. */
export function forgetWalletDatabases(accountIndexes: readonly number[]): void {
  useProfileStore.getState().setWalletDatabaseCreated(accountIndexes, false);
}
