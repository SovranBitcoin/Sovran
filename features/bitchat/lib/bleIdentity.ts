import type { BitchatBLEIdentityMaterial } from 'bitchat-module';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const BITCHAT_BLE_IDENTITY_VERSION = 'sovran-bitchat-ble-v1' as const;

const BITCHAT_BLE_SALT_LABEL = 'sovran:bitchat:ble:v1';
const BITCHAT_BLE_NOISE_LABEL = 'sovran:bitchat:ble:noise:v1';
const BITCHAT_BLE_SIGNING_LABEL = 'sovran:bitchat:ble:signing:v1';
const HEX_32_BYTES_RE = /^[0-9a-f]{64}$/;

interface NostrIdentityInput {
  privateKey: Uint8Array;
  pubkey: string;
}

function normalizeNostrPubkey(pubkey: string): string {
  const normalized = pubkey.trim().toLowerCase();
  if (!HEX_32_BYTES_RE.test(normalized)) {
    throw new Error('Nostr pubkey must be 32-byte hex');
  }
  return normalized;
}

function copyNostrPrivateKey(privateKey: Uint8Array): Uint8Array {
  if (!(privateKey instanceof Uint8Array) || privateKey.byteLength !== 32) {
    throw new Error('Nostr private key must be 32 bytes');
  }
  return new Uint8Array(privateKey);
}

function deriveChildKey(inputKeyMaterial: Uint8Array, salt: Uint8Array, label: string): string {
  const bytes = hkdf(sha256, inputKeyMaterial, salt, utf8ToBytes(label), 32);
  return bytesToHex(bytes);
}

export function deriveBitchatBLEIdentityMaterial({
  privateKey,
  pubkey,
}: NostrIdentityInput): BitchatBLEIdentityMaterial {
  const normalizedPubkey = normalizeNostrPubkey(pubkey);
  const inputKeyMaterial = copyNostrPrivateKey(privateKey);
  const salt = sha256(utf8ToBytes(`${BITCHAT_BLE_SALT_LABEL}:${normalizedPubkey}`));
  let noisePrivateKeyHex: string;
  let signingPrivateKeyHex: string;
  try {
    noisePrivateKeyHex = deriveChildKey(inputKeyMaterial, salt, BITCHAT_BLE_NOISE_LABEL);
    signingPrivateKeyHex = deriveChildKey(inputKeyMaterial, salt, BITCHAT_BLE_SIGNING_LABEL);
  } finally {
    inputKeyMaterial.fill(0);
  }

  return {
    version: BITCHAT_BLE_IDENTITY_VERSION,
    nostrPubkey: normalizedPubkey,
    noisePrivateKeyHex,
    signingPrivateKeyHex,
  };
}

export function isBitchatBLEIdentityMaterial(
  value: BitchatBLEIdentityMaterial | null | undefined
): value is BitchatBLEIdentityMaterial {
  return (
    !!value &&
    value.version === BITCHAT_BLE_IDENTITY_VERSION &&
    HEX_32_BYTES_RE.test(value.nostrPubkey) &&
    HEX_32_BYTES_RE.test(value.noisePrivateKeyHex) &&
    HEX_32_BYTES_RE.test(value.signingPrivateKeyHex)
  );
}
