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

type WhitenoiseHandle = {
  value: WhitenoiseContextValue;
  disposeSigner: (() => void) | null;
};

/**
 * Build the Whitenoise client + invite reader for one account, or an inert
 * handle when there is no key or NDK yet.
 *
 * At module scope: its try/catch holds ternaries, which React Compiler cannot
 * lower — inline it would cost the provider its memoization.
 */
function createWhitenoiseHandle({
  accountIndex,
  privateKey,
  ndk,
}: {
  accountIndex: number;
  privateKey: Uint8Array | undefined;
  ndk: ReturnType<typeof useNDK>['ndk'];
}): WhitenoiseHandle {
  if (!privateKey || !ndk) {
    return {
      value: { client: null, inviteReader: null, relays: defaultRelays, accountIndex },
      disposeSigner: null,
    };
  }
  try {
    const { client, disposeSigner } = createWhitenoiseClient({
      accountIndex,
      privateKey,
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
}

/**
 * Drop the client's listeners and zero the signer's owned copy of the nsec.
 *
 * At module scope: the body's optional calls and ternary sit inside a
 * try/catch, which React Compiler cannot lower. One shared `try` means a
 * throwing `removeAllListeners` skips the disposal below it — long-standing
 * behaviour, preserved here — but nothing escapes the unmount.
 */
function disposeWhitenoiseHandle({
  client,
  inviteReader,
  disposeSigner,
  accountIndex,
}: {
  client: WhitenoiseContextValue['client'];
  inviteReader: WhitenoiseContextValue['inviteReader'];
  disposeSigner: (() => void) | null;
  accountIndex: number;
}): void {
  try {
    client?.removeAllListeners();
    inviteReader?.removeAllListeners();
    disposeSigner?.();
    wnLog.info('whitenoise.client.disposed', { accountIndex });
  } catch (err) {
    wnLog.warn('whitenoise.client.dispose_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function WhitenoiseProvider({
  accountIndex,
  children,
}: {
  accountIndex: number;
  children: React.ReactNode;
}) {
  const { keys } = useNostrKeysContext();
  const { ndk } = useNDK();

  // Optional chain resolved before the memo, and the body lifted out: React
  // Compiler cannot lower a try/catch holding ternaries and optional chaining,
  // nor validate a dep that is itself an optional chain.
  const privateKey = keys?.privateKey;
  const handle = useMemo(
    () => createWhitenoiseHandle({ accountIndex, privateKey, ndk }),
    [accountIndex, privateKey, ndk]
  );

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
    return () =>
      disposeWhitenoiseHandle({ client, inviteReader, disposeSigner, accountIndex: idx });
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
