import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { profileSwitchResource } from '@/shared/lib/profile/profileSwitchResource';
import { registerProfileSwitchService } from '@/shared/lib/account/accountRegistry';
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
  /** Stop invitation admission and drain the client, keeping it held (the switch service). */
  stop: () => Promise<void>;
  /**
   * Let the client go. `switch` (an in-process profile switch): stop, then
   * release. `unmount`: drop the listeners — defense-in-depth against a
   * detached subtree emitting into the dead client — and zero the signer's
   * owned copy of the nsec at once, since Hermes does not zero freed memory
   * on GC (audit 33.json F-004). One shared `try` means a throwing
   * `removeAllListeners` skips the disposal below it — long-standing
   * behaviour, preserved here — but nothing escapes the unmount.
   */
  close: (mode: 'switch' | 'unmount') => Promise<void>;
};

/** The handle when there is no key or NDK yet, or the client failed to build. */
function inertHandle(accountIndex: number): WhitenoiseHandle {
  return {
    value: { client: null, inviteReader: null, accountIndex },
    stop: async () => undefined,
    close: async () => undefined,
  };
}

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
  if (!privateKey || !ndk) return inertHandle(accountIndex);
  try {
    const { client, disposeSigner, shutdown, release } = createWhitenoiseClient({
      accountIndex,
      privateKey,
      ndk,
      fallbackRelays: defaultRelays,
    });
    const inviteReader = new InviteReader({
      signer: client.signer,
      store: createWhitenoiseInviteStore(accountIndex),
    });
    const reader = profileSwitchResource(inviteReader);
    wnLog.info('whitenoise.client.created', { accountIndex });
    const stop = async () => {
      // Stop invitation admission, then drain its decrypt/storage work before zeroing keys.
      await reader.stop();
      inviteReader.removeAllListeners();
      await shutdown();
    };
    return {
      value: { client, inviteReader: reader.value, accountIndex },
      stop,
      close: async (mode) => {
        if (mode === 'switch') {
          await stop();
          reader.release();
          release();
          return;
        }
        try {
          client.removeAllListeners();
          reader.value.removeAllListeners();
          disposeSigner();
          wnLog.info('whitenoise.client.disposed', { accountIndex });
        } catch (err) {
          wnLog.warn('whitenoise.client.dispose_failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      },
    };
  } catch (err) {
    wnLog.error('whitenoise.client.create_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return inertHandle(accountIndex);
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
  // A provider re-keyed or replaced (privateKey or ndk change) lets its
  // client go: drained and released on an in-process profile switch, after
  // descendants have removed their listeners; zeroed at once otherwise.
  useEffect(() => {
    let released = false;
    const dispose = async () => {
      await handle.close('switch');
      released = true;
      unregisterHolder();
    };
    const unregisterHolder = registerAccountScoped('whitenoise.client', dispose, () => released);
    const unregisterService = registerProfileSwitchService('whitenoise', handle.stop);
    return () => {
      unregisterService();
      if (useSettingsStore.getState().inProcessProfileSwitch) {
        void dispose().catch(() => wnLog.warn('whitenoise.shutdown.failed'));
      } else {
        unregisterHolder();
        void handle.close('unmount');
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
