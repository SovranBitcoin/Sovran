import { EventTemplate, finalizeEvent } from 'nostr-tools';
import { Signer } from './types';

export class NsecSigner implements Signer {
  secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
      throw new Error('Expected secret key of 32 bytes');
    }
    this.secretKey = secretKey;
  }
  async signEvent(e: EventTemplate) {
    return finalizeEvent(e, this.secretKey);
  }
}
