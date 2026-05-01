import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import {
  InviteReader,
  type MarmotClient,
} from '@internet-privacy/marmot-ts';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { relays as defaultRelays } from '@/shared/ndk';
import { log } from '@/shared/lib/logger';
import { createWhitenoiseClient } from './client';
import { WhitenoiseGroupHistory } from './storage/groupHistory';
import { createWhitenoiseInviteStore } from './storage/inviteStore';
import { useWhitenoiseInbox } from './hooks/useWhitenoiseInbox';

const wnLog = log.child({ module: 'whitenoise' });

type WnClient = MarmotClient<WhitenoiseGroupHistory>;

type WhitenoiseContextValue = {
  client: WnClient | null;
  inviteReader: InviteReader | null;
  relays: readonly string[];
  accountIndex: number;
};

const WhitenoiseContext = createContext<WhitenoiseContextValue | null>(null);

export function WhitenoiseProvider({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  const { keys } = useNostrKeysContext();
  const { ndk } = useNDK();

  const value = useMemo<WhitenoiseContextValue>(() => {
    if (!keys?.privateKey || !ndk) {
      return { client: null, inviteReader: null, relays: defaultRelays, accountIndex };
    }
    try {
      const client = createWhitenoiseClient({
        accountIndex,
        privateKey: keys.privateKey,
        ndk,
        fallbackRelays: defaultRelays,
      });
      const inviteReader = new InviteReader({
        signer: client.signer,
        store: createWhitenoiseInviteStore(accountIndex),
      });
      wnLog.info('whitenoise.client.created', { accountIndex });
      return { client, inviteReader, relays: defaultRelays, accountIndex };
    } catch (err) {
      wnLog.error('whitenoise.client.create_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { client: null, inviteReader: null, relays: defaultRelays, accountIndex };
    }
  }, [accountIndex, keys?.privateKey, ndk]);

  // When the memoized client/inviteReader is replaced (privateKey or ndk
  // change) or the provider unmounts (profile-switch React-key remount), drop
  // any lingering EventEmitter listeners so a stray reference held by a
  // detached subtree can't keep emitting into the dead client. Hooks already
  // call `.off()` in their own cleanups; this is defense-in-depth.
  useEffect(() => {
    const { client, inviteReader, accountIndex: idx } = value;
    if (!client && !inviteReader) return;
    return () => {
      try {
        client?.removeAllListeners();
        inviteReader?.removeAllListeners();
        wnLog.info('whitenoise.client.disposed', { accountIndex: idx });
      } catch (err) {
        wnLog.warn('whitenoise.client.dispose_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
  }, [value]);

  return (
    <WhitenoiseContext.Provider value={value}>
      <InboxWatcher />
      {children}
    </WhitenoiseContext.Provider>
  );
}

/**
 * Renders nothing — holds the long-running kind-1059 subscription that
 * funnels gift wraps into the InviteReader. Each gift wrap is ingested
 * (deduped via the `seen` store) and decrypted; valid Marmot Welcomes
 * land in `unread` for the user to accept/decline. We do NOT auto-join.
 */
function InboxWatcher() {
  useWhitenoiseInbox();
  return null;
}

export function useWhitenoise(): WhitenoiseContextValue {
  const value = useContext(WhitenoiseContext);
  if (!value) {
    throw new Error('useWhitenoise must be used inside WhitenoiseProvider');
  }
  return value;
}

export function useWhitenoiseClient(): WnClient | null {
  return useWhitenoise().client;
}
