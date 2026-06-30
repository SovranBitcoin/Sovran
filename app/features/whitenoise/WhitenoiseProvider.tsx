import React, { useEffect, useMemo } from 'react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { InviteReader } from '@internet-privacy/marmot-ts';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { relays as defaultRelays } from '@/shared/ndk';
import { wnLog } from '@/shared/lib/logger';
import { createWhitenoiseClient } from './client';
import { createWhitenoiseInviteStore } from './storage/inviteStore';
import { useWhitenoiseInbox } from './hooks/useWhitenoiseInbox';
import { WhitenoiseContext, type WhitenoiseContextValue } from './WhitenoiseContext';

export function WhitenoiseProvider({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  const { keys } = useNostrKeysContext();
  const { ndk } = useNDK();

  const handle = useMemo<{
    value: WhitenoiseContextValue;
    disposeSigner: (() => void) | null;
  }>(() => {
    if (!keys?.privateKey || !ndk) {
      return {
        value: { client: null, inviteReader: null, relays: defaultRelays, accountIndex },
        disposeSigner: null,
      };
    }
    try {
      const { client, disposeSigner } = createWhitenoiseClient({
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
      return {
        value: { client, inviteReader, relays: defaultRelays, accountIndex },
        disposeSigner,
      };
    } catch (err) {
      wnLog.error('whitenoise.client.create_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        value: { client: null, inviteReader: null, relays: defaultRelays, accountIndex },
        disposeSigner: null,
      };
    }
  }, [accountIndex, keys?.privateKey, ndk]);

  const value = handle.value;

  // When the memoized client/inviteReader is replaced (privateKey or ndk
  // change) or the provider unmounts (profile-switch React-key remount):
  // (1) drop EventEmitter listeners — defense-in-depth against a detached
  // subtree emitting into the dead client; (2) zero the signer's owned copy
  // of the user's nsec — Hermes does not zero freed memory on GC, so the
  // raw key bytes would otherwise sit in process memory until the slab is
  // reused. Audit 33.json F-004.
  useEffect(() => {
    const { client, inviteReader, accountIndex: idx } = handle.value;
    const { disposeSigner } = handle;
    if (!client && !inviteReader && !disposeSigner) return;
    return () => {
      try {
        client?.removeAllListeners();
        inviteReader?.removeAllListeners();
        disposeSigner?.();
        wnLog.info('whitenoise.client.disposed', { accountIndex: idx });
      } catch (err) {
        wnLog.warn('whitenoise.client.dispose_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };
  }, [handle]);

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
