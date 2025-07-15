import { NDKKind, NDKEvent } from '@nostr-dev-kit/ndk';
import ndk from 'components/ndk';
import { finalizeEvent, getPublicKey, nip04, nip19, nip59 } from 'nostr-tools';

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

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

interface SendEncryptedDirectMessage {
  message: string;
  recipientPublicKey: string;
  nsec: string;
}

export const sendEncryptedDirectMessage = async ({
  nsec,
  recipientPublicKey,
  message,
}: SendEncryptedDirectMessage): Promise<NDKEvent> => {
  const privKeyBytes = nip19.decode(nsec).data as Uint8Array;
  const privateKey = bytesToHex(privKeyBytes);
  const pubkey = getPublicKey(privKeyBytes);

  // Encrypt the message content
  const content = await nip04.encrypt(privateKey, recipientPublicKey, message);

  // Construct the Kind 4 event
  const event = {
    kind: 4,
    tags: [['p', recipientPublicKey]],
    content,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    id: '',
    sig: '',
  };

  const signedEvent = await finalizeEvent(event, hexToBytes(privateKey));

  if (!signedEvent) {
    throw new Error("Couldn't sign the event!");
  }

  const e = new NDKEvent(ndk, { ...signedEvent });

  await e.publish();

  return e;
};
