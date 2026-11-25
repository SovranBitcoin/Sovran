import * as nip04 from 'nostr-tools/nip04';
import * as nip44 from 'nostr-tools/nip44';
import { finalizeEvent, getPublicKey, type VerifiedEvent } from 'nostr-tools/pure';

export type EncryptionScheme = 'nip44' | 'nip04';

export interface UnsignedNostrEvent {
  kind: number;
  created_at?: number;
  tags: string[][];
  content: string;
  pubkey?: string;
}

export interface NostrSigner {
  readonly pubkey: string;
  sign(template: UnsignedNostrEvent): VerifiedEvent;
  encrypt(peerPubkey: string, plaintext: string, scheme?: EncryptionScheme): string;
  decrypt(peerPubkey: string, ciphertext: string, scheme?: EncryptionScheme): string;
  dispose(): void;
}

/**
 * Isolated in-memory secp256k1 signer backed purely by `nostr-tools`.
 * Copies the 32-byte key on construction and zeroes its internal copy on
 * `dispose()` so account switches never retain key material.
 */
export function createPrivateKeySigner(privateKey: Uint8Array): NostrSigner {
  if (privateKey.length !== 32) {
    throw new RangeError(`Expected 32-byte Nostr secret key, got ${privateKey.length}`);
  }
  const keyCopy = new Uint8Array(privateKey);
  const pubkey = getPublicKey(keyCopy);
  let disposed = false;

  const assertActive = () => {
    if (disposed) {
      throw new Error('NostrSigner has been disposed');
    }
  };

  return {
    pubkey,
    sign(template: UnsignedNostrEvent): VerifiedEvent {
      assertActive();
      if (template.pubkey !== undefined && template.pubkey !== pubkey) {
        throw new Error('Unsigned event pubkey does not match signer pubkey');
      }
      const created_at =
        typeof template.created_at === 'number'
          ? template.created_at
          : Math.floor(Date.now() / 1000);
      return finalizeEvent(
        {
          kind: template.kind,
          created_at,
          tags: template.tags,
          content: template.content,
        },
        keyCopy
      );
    },
    encrypt(peerPubkey: string, plaintext: string, scheme: EncryptionScheme = 'nip44'): string {
      assertActive();
      if (scheme === 'nip04') {
        return nip04.encrypt(keyCopy, peerPubkey, plaintext);
      }
      const convKey = nip44.v2.utils.getConversationKey(keyCopy, peerPubkey);
      return nip44.v2.encrypt(plaintext, convKey);
    },
    decrypt(peerPubkey: string, ciphertext: string, scheme: EncryptionScheme = 'nip44'): string {
      assertActive();
      if (scheme === 'nip04') {
        return nip04.decrypt(keyCopy, peerPubkey, ciphertext);
      }
      const convKey = nip44.v2.utils.getConversationKey(keyCopy, peerPubkey);
      return nip44.v2.decrypt(ciphertext, convKey);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      keyCopy.fill(0);
    },
  };
}
