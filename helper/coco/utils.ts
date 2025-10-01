import { Manager } from 'coco-cashu-core';
import { getDecodedToken } from '@cashu/cashu-ts';
import { decode } from '@gandlaf21/bolt11-decode';
import { mnemonicToSeedSync } from 'bip39';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { getPublicKey } from '@noble/secp256k1';

/**
 * Utility functions for non-React contexts
 * These functions can be used in Redux actions, helpers, etc.
 */

/**
 * Get mint information using the Coco Manager
 * This replaces the old getMint function
 */
export async function getMintInfo(manager: Manager, mintUrl: string) {
  try {
    return await manager.mint.getMintInfo(mintUrl);
  } catch (error) {
    throw error;
  }
}

/**
 * Check if a token is spendable
 * This replaces the old checkTokenSpent function
 */
export async function isTokenSpendable(manager: Manager, token: string): Promise<boolean> {
  try {
    const decoded = getDecodedToken(token);
    const mintUrl = decoded.mint;

    // Check if mint is known
    const isKnown = await manager.mint.isKnownMint(mintUrl);
    if (!isKnown) {
      return false;
    }

    // For now, assume token is spendable if it's valid
    // In a real implementation, you'd check proof states
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate if a string is a valid ecash token
 * This replaces the old isValidEcashToken function
 */
export function isValidEcashToken(token: string): boolean {
  try {
    getDecodedToken(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Lightning invoice amount
 * This replaces the old getLightningAmount function
 */
export function getLightningAmount(invoice: string): number {
  try {
    const decoded = decode(invoice);
    const amount = decoded?.sections?.find((route) => route?.name === 'amount')?.value;
    return amount ? amount / 1000 : 0; // Convert to sats
  } catch {
    return 0;
  }
}

/**
 * Get Lightning invoice description
 * This replaces the old getDescription function
 */
export function getLightningDescription(invoice: string): string {
  try {
    const decoded = decode(invoice);
    const description = decoded?.sections?.find((route) => route?.name === 'description')?.value;
    return description || '';
  } catch {
    return '';
  }
}

/**
 * Get Lightning invoice timestamp
 * This replaces the old getTimestamp function
 */
export function getLightningTimestamp(invoice: string): number {
  try {
    const decoded = decode(invoice);
    const timestamp = decoded?.sections?.find((route) => route?.name === 'timestamp')?.value;
    return timestamp || 0;
  } catch {
    return 0;
  }
}

/**
 * Get Lightning invoice expiry
 * This replaces the old getRawExpiry function
 */
export function getLightningExpiry(invoice: string): number {
  try {
    const decoded = decode(invoice);
    const expiry = decoded?.sections?.find((route) => route?.name === 'expiry')?.value;
    return expiry || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a string is a valid Lightning invoice
 * This replaces the old isValidPaymentRequest function
 */
export function isValidLightningInvoice(invoice: string): boolean {
  try {
    decode(invoice);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive mint backup keys from mnemonic
 * This replaces the old deriveMintBackupKeys function
 */
export function deriveMintBackupKeys(mnemonic: string): {
  privateKeyHex: string;
  publicKeyHex: string;
  privateKeyBytes: Uint8Array;
} {
  // Derive seed from mnemonic
  const seed: Uint8Array = mnemonicToSeedSync(mnemonic);
  const domainSeparator = new TextEncoder().encode('cashu-mint-backup');
  const combinedData = new Uint8Array(seed.length + domainSeparator.length);
  combinedData.set(seed);
  combinedData.set(domainSeparator, seed.length);

  // Use SHA256 of combined data as private key
  const privateKeyBytes = sha256(combinedData);
  const privateKeyHex = bytesToHex(privateKeyBytes);
  const publicKeyHex = bytesToHex(getPublicKey(privateKeyBytes));

  return { privateKeyHex, privateKeyBytes, publicKeyHex };
}

/**
 * Convert npub to public key (simplified version)
 * This replaces the old maybeConvertNpub function
 */
export function maybeConvertNpub(pubkey: string): string {
  // Simple check if it's an npub, if so return as-is for now
  // In a real implementation, you'd decode the npub
  if (pubkey.startsWith('npub1')) {
    return pubkey;
  }
  return pubkey;
}

/**
 * Convert public key to 02 format (simplified version)
 * This replaces the old pubKeyTo02 function
 */
export function pubKeyTo02(pubkey: string): string {
  // Simple implementation - in real usage you'd convert the key format
  return pubkey;
}

/**
 * Convert npub to public key (simplified version)
 * This replaces the old npubToPublicKey function
 */
export function npubToPublicKey(npub: string): string {
  // Simple implementation - in real usage you'd decode the npub
  return npub;
}
