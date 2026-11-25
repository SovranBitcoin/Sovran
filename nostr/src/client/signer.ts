import { finalizeEvent, getPublicKey, type VerifiedEvent } from 'nostr-tools/pure';

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
  dispose(): void;
}

/**
 * Isolated in-memory secp256k1 signer backed purely by `nostr-tools/pure`.
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

  return {
    pubkey,
    sign(template: UnsignedNostrEvent): VerifiedEvent {
      if (disposed) {
        throw new Error('NostrSigner has been disposed');
      }
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
    dispose(): void {
      if (disposed) return;
      disposed = true;
      keyCopy.fill(0);
    },
  };
}
