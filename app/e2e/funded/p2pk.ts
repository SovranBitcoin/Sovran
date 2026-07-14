import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';

export interface ControlledP2PKKeypair {
  privateKey: string;
  /** Cashu app contract: 02 + BIP-340 x-only public key. */
  publicKey: string;
}

export function controlledP2PKPublicKey(privateKey: string): string {
  if (!/^[0-9a-f]{64}$/.test(privateKey)) {
    throw new Error('controlled P2PK private key must be 32-byte lowercase hex');
  }
  try {
    return `02${bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)))}`;
  } catch {
    throw new Error('controlled P2PK private key is not a valid secp256k1 scalar');
  }
}

export function generateControlledP2PKKeypair(): ControlledP2PKKeypair {
  const { secretKey, publicKey } = schnorr.keygen();
  return {
    privateKey: bytesToHex(secretKey),
    publicKey: `02${bytesToHex(publicKey)}`,
  };
}
