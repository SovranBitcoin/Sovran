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

export type WhitenoiseSigner = EventSignerLike & {
  /**
   * Zeros the signer's owned copy of the private key and trips a guard so
   * subsequent sign / nip44 calls throw. Defense-in-depth on profile switch
   * — nostr-tools' `nip44.v2.utils.getConversationKey` may cache derived
   * secrets internally (UNVERIFIED upstream); zeroing the input is the
   * minimal step we control.
   */
  dispose: () => void;
};

const DISPOSED_ERROR = 'whitenoise.signer: disposed';

export function createWhitenoiseSigner(privateKey: Uint8Array): WhitenoiseSigner {
  const buf = new Uint8Array(privateKey);
  const pubkey = getPublicKey(buf);
  let disposed = false;

  return {
    getPublicKey() {
      return pubkey;
    },
    signEvent(draft) {
      if (disposed) throw new Error(DISPOSED_ERROR);
      return finalizeEvent(draft as EventTemplate, buf);
    },
    nip44: {
      encrypt(peerPubkey, plaintext) {
        if (disposed) throw new Error(DISPOSED_ERROR);
        const key = nip44.v2.utils.getConversationKey(buf, peerPubkey);
        return nip44.v2.encrypt(plaintext, key);
      },
      decrypt(peerPubkey, ciphertext) {
        if (disposed) throw new Error(DISPOSED_ERROR);
        const key = nip44.v2.utils.getConversationKey(buf, peerPubkey);
        return nip44.v2.decrypt(ciphertext, key);
      },
    },
    dispose() {
      if (disposed) return;
      buf.fill(0);
      disposed = true;
    },
  };
}
