import { Manager } from 'coco-cashu-core';
import { getDecodedToken } from '@cashu/cashu-ts';
import { decode } from '@gandlaf21/bolt11-decode';
import { nip19 } from 'nostr-tools';
import _ from 'lodash';

/**
 * Get mint information using the Coco Manager
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

export function maybeConvertNpub(key: string) {
  // Check and convert npub to P2PK
  if (key && key.startsWith('npub1')) {
    const { type, data } = nip19.decode(key);
    if (type === 'npub' && data.length === 64) {
      key = '02' + data;
    }
  }
  return key;
}

export const isLightningInvoice = (invoice: string): boolean => {
  try {
    decode(invoice);
    return true;
  } catch {
    return false;
  }
};

export function lnTrim(str: string) {
  if (!str || !_.isString(str)) {
    return '';
  }
  str = str.trim().toLowerCase();
  const uriPrefixes = [
    'lightning:',
    'lightning=',
    'lightning://',
    'lnurlp://',
    'lnurlp=',
    'lnurlp:',
    'lnurl:',
    'lnurl=',
    'lnurl://',
  ];
  uriPrefixes.forEach((prefix) => {
    if (!str.startsWith(prefix)) {
      return;
    }
    str = str.slice(prefix.length).trim();
  });
  return str.trim();
}
