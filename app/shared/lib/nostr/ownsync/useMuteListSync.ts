import { useNostrClient } from '@/runtime/nostrClient';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { syncMuteList } from '../moderation';
import { useRelayListStore } from '../outbox/relayListStore';
import { useFeedIgnoreStore } from '@/shared/stores/profile/ignoreStore';

/** Restore imported-account lists at startup and refresh cross-client edits on foreground. */
export function useMuteListSync() {
  const { client, isInitialized } = useNostrClient();
  const pubkey = useNostrKeysContext().keys?.pubkey;
  const writeRelays = useRelayListStore((s) =>
    s.entries
      .filter((entry) => entry.write)
      .map((entry) => entry.url)
      .join('\n')
  );
  useEffect(() => {
    if (!isInitialized || !client || !pubkey) return;
    let loading = false;
    const refresh = () => {
      if (loading || !useFeedIgnoreStore.persist.hasHydrated()) return;
      loading = true;
      void syncMuteList(client, pubkey)
        .catch(() => undefined)
        .finally(() => {
          loading = false;
        });
    };
    refresh();
    const stopHydration = useFeedIgnoreStore.persist.onFinishHydration(refresh);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      subscription.remove();
      stopHydration();
    };
  }, [client, pubkey, isInitialized, writeRelays]);
}
