import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';

import { requestFollowSync } from '@/shared/lib/nostr/followSync';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useNostrNDKContext } from '@/shared/providers/NostrNDKProvider';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';

/**
 * Starts the follow worker whenever outstanding follow taps could be
 * published: once the account's saved state has loaded (which resumes a tap
 * saved before the app closed), on each new tap, when a follow list arrives,
 * and on returning to the foreground.
 */
export function useFollowSync() {
  const { ndk } = useNDK();
  const { isInitialized } = useNostrNDKContext();
  const pubkey = useNostrKeysContext().keys?.pubkey;
  useEffect(() => {
    if (!isInitialized || !ndk || !pubkey) return;
    const request = () => {
      if (useNostrSocialStore.persist.hasHydrated()) void requestFollowSync(ndk, pubkey);
    };
    request();
    const stopHydration = useNostrSocialStore.persist.onFinishHydration(request);
    const stopStore = useNostrSocialStore.subscribe((state, previous) => {
      if (
        state.optimisticFollowsByPubkey !== previous.optimisticFollowsByPubkey ||
        state.contactsUpdatedAt !== previous.contactsUpdatedAt
      )
        request();
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') request();
    });
    return () => {
      subscription.remove();
      stopStore();
      stopHydration();
    };
  }, [ndk, pubkey, isInitialized]);
}
