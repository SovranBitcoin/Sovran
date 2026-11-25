import { useNostrClient } from '@/shared/providers/NostrClientProvider';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { requestFollowSync } from '@/shared/lib/nostr/followSync';
import { getOwnWriteRelays, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

/**
 * Starts the follow worker whenever outstanding follow taps could be
 * published: once the NostrClient and its signer are ready and the account's saved
 * state has loaded (which resumes a tap saved before the app closed), when the
 * network comes back, on each new tap, when a follow list or seed is taken in
 * (also one from the same second), when this session discovers the account's
 * relay list or it changes, when a write relay connects, and on returning to the foreground.
 */
export function useFollowSync() {
  const { client, isInitialized } = useNostrClient();
  const { isOffline } = useOfflineStatus();
  const pubkey = useNostrKeysContext().keys?.pubkey;
  useEffect(() => {
    if (!isInitialized || !client || !pubkey || isOffline) return;
    const request = () => {
      if (useNostrSocialStore.persist.hasHydrated()) void requestFollowSync(client, pubkey);
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
    const offRelayConnect = client.on('relay:connect', (url) => {
      if (getOwnWriteRelays().includes(url)) request();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') request();
    });
    return () => {
      subscription.remove();
      offRelayConnect();
      stopStore();
      stopRelays();
      stopRelayHydration();
      stopHydration();
    };
  }, [client, pubkey, isInitialized, isOffline]);
}
