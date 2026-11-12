import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNDK, type NDKRelay } from '@nostr-dev-kit/ndk-mobile';

import { requestFollowSync } from '@/shared/lib/nostr/followSync';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrNDKContext } from '@/shared/providers/NostrNDKProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

/**
 * Starts the follow worker whenever outstanding follow taps could be
 * published: once the NDK and its signer are ready and the account's saved
 * state has loaded (which resumes a tap saved before the app closed), when the
 * network comes back, on each new tap, when a follow list or seed is taken in
 * (also one from the same second), when this session discovers the account's
 * relay list or it changes, when a write relay connects, and on returning to the foreground.
 */
export function useFollowSync() {
  const { ndk } = useNDK();
  const { isInitialized } = useNostrNDKContext();
  const { isOffline } = useOfflineStatus();
  const pubkey = useNostrKeysContext().keys?.pubkey;
  useEffect(() => {
    if (!isInitialized || !ndk || !pubkey || isOffline) return;
    const request = () => {
      if (useNostrSocialStore.persist.hasHydrated()) void requestFollowSync(ndk, pubkey);
    };
    request();
    const stopHydration = useNostrSocialStore.persist.onFinishHydration(request);
    const stopRelayHydration = useRelayListStore.persist.onFinishHydration(request);
    const stopRelays = useRelayListStore.subscribe((state, previous) => {
      if (
        state.entries !== previous.entries ||
        state.source !== previous.source ||
        state.discoveredFor !== previous.discoveredFor
      )
        request();
    });
    const stopStore = useNostrSocialStore.subscribe((state, previous) => {
      if (
        state.optimisticFollowsByPubkey !== previous.optimisticFollowsByPubkey ||
        state.contactsUpdatedAt !== previous.contactsUpdatedAt ||
        state.contactsEvent !== previous.contactsEvent
      )
        request();
    });
    // A write relay that did not answer a read may answer now.
    const onRelayConnect = (relay: NDKRelay) => {
      if (getOwnWriteRelays().includes(relay.url)) request();
    };
    ndk.pool.on('relay:connect', onRelayConnect);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') request();
    });
    return () => {
      subscription.remove();
      ndk.pool.off('relay:connect', onRelayConnect);
      stopStore();
      stopRelays();
      stopRelayHydration();
      stopHydration();
    };
  }, [ndk, pubkey, isInitialized, isOffline]);
}
