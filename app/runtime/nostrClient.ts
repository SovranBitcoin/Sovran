/**
 * The active account's Nostr client: created by the account scope once the
 * keys are loaded, held by the app runtime, read anywhere with
 * `useNostrClient`.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createPrivateKeySigner, NostrClient } from 'nostr/client';

import {
  profileSwitchQuiescing,
  registerAccountScoped,
  registerProfileSwitchService,
} from '@/shared/lib/account/accountRegistry';
import { relays } from '@/shared/ndk';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { pauseInBackground } from '@/shared/lib/nostr/pauseInBackground';
import { useOwnRelayListSync } from '@/shared/lib/nostr/outbox/useOwnRelayListSync';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { nostrLog, useInitMount } from '@/shared/lib/logger';
import { useInitializationStage } from './initializationStages';
import { accountHandle } from './accountHandle';

const getClient = () => accountHandle.get().nostrClient;

/**
 * The active account's Nostr client, once its keys are loaded. Before then,
 * and outside an account, there is no client (`isInitialized: false`), which
 * fails safe.
 */
export function useNostrClient(): { client: NostrClient | undefined; isInitialized: boolean } {
  const client = useSyncExternalStore(accountHandle.subscribe, getClient, getClient);
  return useMemo(() => ({ client, isInitialized: client !== undefined }), [client]);
}

/**
 * Owns one `NostrClient` per account: its relay sockets and an in-memory
 * signer for the account's key. Account switching and Delete All dispose it,
 * which closes every socket and zeroes the signer's key copy. While the app is
 * in the background the client is paused: it does not redial dropped relays
 * and holds no socket that carries nothing.
 */
export function useNostrClientLifecycle(accountIndex: number): void {
  useInitMount('NostrClientProvider');
  const { keys: nostrKeys } = useNostrKeysContext();
  const privateKey = nostrKeys?.privateKey;
  const pubkey = nostrKeys?.pubkey;
  const { client } = useNostrClient();

  // Non-blocking: starts after the wallet is open so it never competes with splash.
  const stage = useInitializationStage('nostr-client');

  // Hydrate the NIP-17 unwrap cache first: the DM decrypt path reads it
  // synchronously, so a late hydration would force every wrap to re-decrypt.
  useEffect(() => {
    if (!pubkey) return;
    void giftWrapCache.cache.hydrate(pubkey);
  }, [pubkey]);

  useEffect(() => {
    if (!stage.canStart || !privateKey) return;
    let created: NostrClient;
    try {
      created = new NostrClient({ relays, signer: createPrivateKeySigner(privateKey) });
    } catch (err) {
      nostrLog.error('provider.nostr_client.init_failed', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      stage.error(err instanceof Error ? err.message : 'Nostr initialization failed');
      return;
    }
    const unregisterService = registerProfileSwitchService('nostr.client', () => {
      created.dispose();
    });
    const unregisterHolder = registerAccountScoped(
      `nostr.client:${accountIndex}`,
      () => {
        created.dispose();
        unregisterHolder();
      },
      () => created.disposed && created.signer === undefined
    );
    nostrLog.info('provider.nostr_client.ready', { relayCount: relays.length, accountIndex });
    // No reconnect timers and no idle sockets while the app is in the
    // background. A publish started there still opens the socket it needs.
    const stopPausing = pauseInBackground(created, AppState);
    accountHandle.setNostrClient(created);
    stage.complete();
    return () => {
      const switching = profileSwitchQuiescing();
      stopPausing();
      unregisterService();
      // While switching, the registry disposes and verifies the holder itself.
      if (!switching) unregisterHolder();
      created.dispose();
      accountHandle.clearNostrClient(created);
    };
  }, [stage, privateKey, accountIndex]);

  // Ingest the profile's NIP-65 relay list (or first-run-publish the defaults)
  // and seed the pool, once the client is ready. Self-deferred internally.
  useOwnRelayListSync(client, pubkey);
}
