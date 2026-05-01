import { finalizeEvent, getPublicKey, nip44 } from 'nostr-tools';
import type { EventTemplate, UnsignedEvent } from 'nostr-tools';

type EventSignerLike = {
  getPublicKey: () => string;
  signEvent: (draft: EventTemplate | UnsignedEvent) => ReturnType<typeof finalizeEvent>;
  nip44: {
    encrypt: (peerPubkey: string, plaintext: string) => string;
    decrypt: (peerPubkey: string, ciphertext: string) => string;
  };
};

export function createWhitenoiseSigner(privateKey: Uint8Array): EventSignerLike {
  const pubkey = getPublicKey(privateKey);
  return {
    getPublicKey() {
      return pubkey;
    },
    signEvent(draft) {
      return finalizeEvent(draft as EventTemplate, privateKey);
    },
    nip44: {
      encrypt(peerPubkey, plaintext) {
        const key = nip44.v2.utils.getConversationKey(privateKey, peerPubkey);
        return nip44.v2.encrypt(plaintext, key);
      },
      decrypt(peerPubkey, ciphertext) {
        const key = nip44.v2.utils.getConversationKey(privateKey, peerPubkey);
        return nip44.v2.decrypt(ciphertext, key);
      },
    },
  };
}
