import { NDKKind, NDKEvent } from '@nostr-dev-kit/ndk';
import ndk from 'components/ndk';
import { nip19, nip59, finalizeEvent, SimplePool } from 'nostr-tools';
import { store } from 'helper/redux/store';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { relays } from 'components/ndk';
import { ok, err, Result } from 'neverthrow';

interface SendGiftWrappedEncryptedDirectMessage {
  message: string;
  recipient: string;
  nsec: string;
}

export const sendGiftWrappedEncryptedDirectMessage = async ({
  message,
  recipient,
  nsec,
}: SendGiftWrappedEncryptedDirectMessage): Promise<Result<NDKEvent, Error>> => {
  const privKeyBytes: Uint8Array = nip19.decode(nsec).data as Uint8Array;

  const directMessageEvent = {
    created_at: Math.ceil(Date.now() / 1000),
    kind: NDKKind.EncryptedDirectMessage,
    tags: [['p', recipient]],
    content: message,
  };

  try {
    const wrappedEvent = nip59.wrapEvent(
      directMessageEvent,
      privKeyBytes,
      recipient
    );

    const e = new NDKEvent(ndk, { ...wrappedEvent });

    await e.publish();

    return ok(e);
  } catch (e) {
    return err(e as Error);
  }
};

interface NostrEvent {
  kind: number;
  tags: string[][];
  pubkey: string;
  content: string;
  created_at: number;
}

export const publishWalletEvent = async (
  mints: string[],
  units: string[] = ['sat']
): Promise<Result<void, Error>> => {
  try {
    const currentProfile = memoizedGetCurrentProfile(store.getState());

    if (!currentProfile?.pubkey || !currentProfile?.nsec) {
      return err(new Error('No valid profile available'));
    }

    const pubKey = currentProfile.pubkey;
    const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);

    if (!(privKeyBytes instanceof Uint8Array)) {
      return err(new Error('Invalid private key format'));
    }

    const event: NostrEvent = {
      kind: 37375,
      tags: [
        ['d', 'my-cashu-wallet'],
        ...mints
          .filter((item, index, self) => index === self.findIndex((t) => t === item))
          .map((mint) => ['mint', mint]),
        ['name', 'Sovran Wallet'],
        ['unit', units[0] ?? 'sat'],
        ['description', 'iOS Sovran wallet'],
        ...relays
          .filter((item, index, self) => index === self.findIndex((t) => t === item))
          .map((relay) => ['relay', relay]),
      ],
      pubkey: pubKey,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    };

    const pool = new SimplePool();
    await Promise.all(pool.publish(relays, finalizeEvent(event, privKeyBytes)));
    pool.close(relays);
    return ok(undefined);
  } catch (e) {
    return err(e as Error);
  }
};
