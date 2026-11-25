/**
 * The app runtime: the non-visual lifecycle and background services, outside
 * React.
 *
 * - `startProcess()` runs once while the app root is mounted: the
 *   connectivity engine, the profile-transition controls, and startup
 *   cleanup of what an earlier run or an older build left behind.
 * - `start(accountIndex)` / `stop()` bracket one account scope (mounted with
 *   `key=account-<index>`, so a switch stops the old account before the new
 *   one starts): the price feed, and the account's Nostr client once the
 *   account scope has created it.
 * - `getSnapshot()` / `subscribe()` expose the active account
 *   (`accountHandle`) to React through `useSyncExternalStore`.
 *
 * What an account leaves outside React and how a switch replaces it is listed
 * in `shared/lib/account/accountRegistry.ts`; the switch transaction itself is
 * `runInProcessProfileSwitch`.
 */
import { AppState } from 'react-native';

import { createPricelistFeed } from '@/shared/lib/pricelistFeed';
import { usePricelistStore } from '@/shared/stores/global/pricelistStore';
import { reportAsyncStorageUsage } from '@/shared/lib/persist/storageUsage';
import { clearLegacyPairingIntent } from '@/shared/lib/profile/legacyNip46Cleanup';
import {
  clearTransitionGuardOnStartup,
  registerTransitionControls,
} from '@/shared/lib/profile/profileTransition';
import { cashuLog } from '@/shared/lib/logger';
import { getOfflineStatus, startConnectivity, subscribeOfflineStatus } from './connectivity';
import { initializationStages } from './initializationStages';
import { accountHandle } from './accountHandle';

const STORAGE_USAGE_REPORT_DELAY_MS = 60_000;

/**
 * The BTC price feed for one account scope. Only the phone reporting no
 * network pauses it. Failed reachability probes do not: Coinbase's /v2/time
 * can be the only probe, and Coinbase being down is exactly when the feed must
 * still reach Mempool.space; the feed's own backoff bounds those retries.
 */
export function startPricelistFeed(): () => void {
  const feed = createPricelistFeed({
    onPrices: (prices) => usePricelistStore.getState().setBtcPrices(prices),
    onLoading: (loading) => usePricelistStore.getState().setLoading(loading),
    onError: (error) => usePricelistStore.getState().setError(error),
  });
  // Disconnected pauses the feed (cancelling any request); reconnecting
  // refreshes at once when a poll is due or the last one failed. The feed
  // ignores a repeated state. Set before start so it never dials out offline.
  feed.setOffline(getOfflineStatus().isDisconnected);
  const unsubscribeOffline = subscribeOfflineStatus(() =>
    feed.setOffline(getOfflineStatus().isDisconnected)
  );
  feed.start();
  // Refresh on foreground. The feed deduplicates requests and skips resumes
  // within 60 seconds of a successful poll.
  const appState = AppState.addEventListener('change', (next) => {
    if (next === 'active') feed.resume('foreground');
  });
  return () => {
    appState.remove();
    unsubscribeOffline();
    feed.stop();
  };
}

function createAppRuntime() {
  let stopAccountServices: (() => void) | null = null;

  return {
    startProcess(): () => void {
      const stopConnectivity = startConnectivity();
      // Profile transitions hold the splash by resetting the stage graph.
      registerTransitionControls(initializationStages);
      // Leftovers: a transition guard from a restart mid-switch, and a Remote
      // Login pairing link an older build left.
      void clearTransitionGuardOnStartup();
      void clearLegacyPairingIntent();
      // Once per run, well after startup: how full AsyncStorage is. Android
      // caps it, and a full database fails saves with nothing on screen.
      const timer = setTimeout(() => void reportAsyncStorageUsage(), STORAGE_USAGE_REPORT_DELAY_MS);
      return () => {
        clearTimeout(timer);
        stopConnectivity();
      };
    },
    start(accountIndex: number): void {
      // The account scope's own effects (its Nostr client) run before this
      // one, so starting keeps whatever client they already published.
      stopAccountServices?.();
      cashuLog.info('app.runtime.account_start', { accountIndex });
      stopAccountServices = startPricelistFeed();
      accountHandle.setAccount(accountIndex);
    },
    stop(): void {
      if (stopAccountServices) {
        cashuLog.info('app.runtime.account_stop', {
          accountIndex: accountHandle.get().accountIndex,
        });
        stopAccountServices();
        stopAccountServices = null;
      }
      accountHandle.setAccount(null);
    },
    getSnapshot: accountHandle.get,
    subscribe: accountHandle.subscribe,
  };
}

export const appRuntime = createAppRuntime();
