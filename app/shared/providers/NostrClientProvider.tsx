import {
  profileSwitchQuiescing,
  registerAccountScoped,
  registerProfileSwitchService,
} from '@/shared/lib/account/accountRegistry';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPrivateKeySigner, NostrClient } from 'nostr/client';
import { relays } from '@/shared/ndk';
import { giftWrapCache } from '@/shared/lib/nostr/giftWrapCache';
import { useOwnRelayListSync } from '@/shared/lib/nostr/outbox/useOwnRelayListSync';
import { useInitializationStage } from './InitializationProvider';
import { useNostrKeysContext } from './NostrKeysProvider';
import { nostrLog, useInitMount } from '@/shared/lib/logger';

interface NostrClientContextValue {
  client: NostrClient | undefined;
  isInitialized: boolean;
}

const NostrClientContext = createContext<NostrClientContextValue>({
  client: undefined,
  isInitialized: false,
});

/**
 * The active account's Nostr client, once its keys are loaded. Outside the
 * provider this returns no client (`isInitialized: false`), which fails safe.
 */
export function useNostrClient(): NostrClientContextValue {
  return useContext(NostrClientContext);
}

/**
 * Owns one `NostrClient` per account: its relay sockets and an in-memory
 * signer for the account's key. Account switching and Delete All dispose it,
 * which closes every socket and zeroes the signer's key copy.
 */
export function NostrClientProvider({
  children,
  accountIndex = 0,
}: {
  children: ReactNode;
  accountIndex?: number;
}) {
  useInitMount('NostrClientProvider');
  const { keys: nostrKeys } = useNostrKeysContext();
  const privateKey = nostrKeys?.privateKey;
  const pubkey = nostrKeys?.pubkey;
  const [client, setClient] = useState<NostrClient>();

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
    setClient(created);
    stage.complete();
    return () => {
      const switching = profileSwitchQuiescing();
      unregisterService();
      // While switching, the registry disposes and verifies the holder itself.
      if (!switching) unregisterHolder();
      created.dispose();
      setClient((current) => (current === created ? undefined : current));
    };
  }, [stage, privateKey, accountIndex]);

  // Ingest the profile's NIP-65 relay list (or first-run-publish the defaults)
  // and seed the pool, once the client is ready. Self-deferred internally.
  useOwnRelayListSync(client, pubkey);

  const value = useMemo(() => ({ client, isInitialized: client !== undefined }), [client]);
  return <NostrClientContext.Provider value={value}>{children}</NostrClientContext.Provider>;
}
