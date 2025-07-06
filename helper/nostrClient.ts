import { NDKKind, NDKEvent } from '@nostr-dev-kit/ndk';
import ndk from 'components/ndk';
import { nip19, nip59 } from 'nostr-tools';

interface SendGiftWrappedEncryptedDirectMessage {
  message: string;
  recipient: string;
  nsec: string;
}

export const sendGiftWrappedEncryptedDirectMessage = async ({
  message,
  recipient,
  nsec,
}: SendGiftWrappedEncryptedDirectMessage): Promise<NDKEvent> => {
  const privKeyBytes: Uint8Array = nip19.decode(nsec).data as Uint8Array;

  const directMessageEvent = {
    created_at: Math.ceil(Date.now() / 1000),
    kind: NDKKind.EncryptedDirectMessage,
    tags: [['p', recipient]],
    content: message,
  };

  const wrappedEvent = nip59.wrapEvent(directMessageEvent, privKeyBytes, recipient);

  const e = new NDKEvent(ndk, { ...wrappedEvent });

  await e.publish();

  return e;
};
