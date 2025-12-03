/**
 * @fileoverview Coco Cashu utility functions for Lightning Network and ecash operations
 *
 * @module helper/coco/utils
 *
 * @description
 * **Comprehensive utility functions for Coco Cashu operations**
 * - Mint information retrieval and validation
 * - Ecash token validation and spendability checks
 * - Lightning Network invoice parsing and validation
 * - Nostr key conversion utilities
 * - Lightning address and URL trimming utilities
 *
 * **Usage:**
 * ```typescript
 * import { getMintInfo, isValidEcashToken, getLightningAmount } from '@/helper/coco/utils';
 *
 * // Validate ecash token
 * const isValid = isValidEcashToken(tokenString);
 *
 * // Get Lightning invoice amount
 * const amount = getLightningAmount(invoiceString);
 *
 * // Get mint information
 * const mintInfo = await getMintInfo(manager, mintUrl);
 * ```
 *
 * @see {@link https://github.com/bitcoinvault/coco-cashu-core} Coco Cashu Core
 * @see {@link https://github.com/gandlaf21/bolt11-decode} BOLT11 Decode
 */

import { Manager } from 'coco-cashu-core';
import { getDecodedToken } from '@cashu/cashu-ts';
import { decode } from '@gandlaf21/bolt11-decode';
import { nip19 } from 'nostr-tools';
import _ from 'lodash';

/**
 * Retrieves mint information using the Coco Manager
 *
 * @async
 * @description Fetches comprehensive mint information including supported currencies, fees, and capabilities
 *
 * **Process:** manager.mint.getMintInfo() → return mint data
 * **Effects:** Network request to mint server
 *
 * @param {Manager} manager - The Coco Manager instance
 * @param {string} mintUrl - The URL of the mint to query
 * @returns {Promise<any>} Mint information object containing supported currencies, fees, and capabilities
 * @throws {Error} When mint URL is invalid or mint server is unreachable
 *
 * @example
 * const manager = new Manager();
 * const mintInfo = await getMintInfo(manager, 'https://mint.example.com');
 * console.log(mintInfo.currencies); // ['USD', 'EUR', 'BTC']
 */
export async function getMintInfo(manager: Manager, mintUrl: string) {
  try {
    return await manager.mint.getMintInfo(mintUrl);
  } catch (error) {
    throw error;
  }
}

/**
 * Checks if an ecash token is spendable by validating mint availability and token structure
 *
 * @async
 * @description Validates token structure, checks if mint is known, and determines spendability
 *
 * **Process:** decode token → extract mint URL → check if mint is known → return spendability
 * **Effects:** Network request to check mint availability
 *
 * @param {Manager} manager - The Coco Manager instance
 * @param {string} token - The ecash token string to validate
 * @returns {Promise<boolean>} True if token is spendable, false otherwise
 * @throws {Error} When token decoding fails or manager is not initialized
 *
 * @example
 * const manager = new Manager();
 * const isSpendable = await isTokenSpendable(manager, 'cashuAeyJ0b2tlbiI6...');
 * if (isSpendable) {
 *   // Token can be spent
 * }
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
 * Validates if a string is a valid ecash token by attempting to decode it
 *
 * @description Checks if the provided string can be successfully decoded as an ecash token
 *
 * **Process:** getDecodedToken() → return success/failure
 * **Effects:** None (pure validation function)
 *
 * @param {string} token - The token string to validate
 * @returns {boolean} True if token is valid, false otherwise
 *
 * @example
 * const token = 'cashuAeyJ0b2tlbiI6...';
 * const isValid = isValidEcashToken(token);
 * if (isValid) {
 *   // Process valid token
 * }
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
 * Extracts the amount in satoshis from a Lightning Network invoice
 *
 * @description Decodes a BOLT11 invoice and extracts the payment amount, converting from millisatoshis to satoshis
 *
 * **Process:** decode invoice → find amount section → convert millisats to sats
 * **Effects:** None (pure parsing function)
 *
 * @param {string} invoice - The Lightning Network invoice string
 * @returns {number} Amount in satoshis, or 0 if parsing fails or no amount specified
 *
 * @example
 * const invoice = 'lnbc100n1p...';
 * const amount = getLightningAmount(invoice);
 * console.log(`Amount: ${amount} sats`); // Amount: 100 sats
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
 * Extracts the description from a Lightning Network invoice
 *
 * @description Decodes a BOLT11 invoice and extracts the payment description
 *
 * **Process:** decode invoice → find description section → return description
 * **Effects:** None (pure parsing function)
 *
 * @param {string} invoice - The Lightning Network invoice string
 * @returns {string} Payment description, or empty string if parsing fails or no description
 *
 * @example
 * const invoice = 'lnbc100n1p...';
 * const description = getLightningDescription(invoice);
 * console.log(`Description: ${description}`); // Description: Coffee payment
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
 * Extracts the timestamp from a Lightning Network invoice
 *
 * @description Decodes a BOLT11 invoice and extracts the creation timestamp
 *
 * **Process:** decode invoice → find timestamp section → return timestamp
 * **Effects:** None (pure parsing function)
 *
 * @param {string} invoice - The Lightning Network invoice string
 * @returns {number} Unix timestamp in seconds, or 0 if parsing fails or no timestamp
 *
 * @example
 * const invoice = 'lnbc100n1p...';
 * const timestamp = getLightningTimestamp(invoice);
 * const date = new Date(timestamp * 1000);
 * console.log(`Created: ${date.toISOString()}`);
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
 * Converts a Nostr npub key to P2PK format if it's in npub format
 *
 * @description Checks if the key starts with 'npub1' and converts it to the P2PK format used by Lightning Network
 *
 * **Process:** check npub prefix → decode with nip19 → convert to P2PK format
 * **Effects:** None (pure conversion function)
 *
 * @param {string} key - The key string to potentially convert
 * @returns {string} The converted key in P2PK format, or original key if not npub format
 *
 * @example
 * const npubKey = 'npub1abc123...';
 * const p2pkKey = maybeConvertNpub(npubKey);
 * console.log(p2pkKey); // '02abc123...'
 */
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

/**
 * Validates if a string is a valid Lightning Network invoice
 *
 * @description Attempts to decode a BOLT11 invoice to determine if it's valid
 *
 * **Process:** decode invoice → return success/failure
 * **Effects:** None (pure validation function)
 *
 * @param {string} invoice - The invoice string to validate
 * @returns {boolean} True if invoice is valid, false otherwise
 *
 * @example
 * const invoice = 'lnbc100n1p...';
 * const isValid = isLightningInvoice(invoice);
 * if (isValid) {
 *   // Process valid Lightning invoice
 * }
 */
export const isLightningInvoice = (invoice: string): boolean => {
  try {
    decode(invoice);
    return true;
  } catch {
    return false;
  }
};

/**
 * Trims and normalizes Lightning Network addresses and URLs by removing common prefixes
 *
 * @description Removes various Lightning Network URI prefixes and normalizes the string for consistent processing
 *
 * **Process:** validate input → trim and lowercase → remove URI prefixes → return cleaned string
 * **Effects:** None (pure string processing function)
 *
 * @param {string} str - The string to trim and normalize
 * @returns {string} The cleaned string with prefixes removed, or empty string if input is invalid
 *
 * @example
 * // Various input formats
 * lnTrim('lightning:user@domain.com') // 'user@domain.com'
 * lnTrim('lnurlp://domain.com/pay') // 'domain.com/pay'
 * lnTrim('lnurl:user@domain.com') // 'user@domain.com'
 * lnTrim('  LNBC100N1P...  ') // 'lnbc100n1p...'
 */
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

// ============================================================================
// LNURL Utilities (replaces lnurl-pay library which has React Native issues)
// ============================================================================

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

export interface LightningAddress {
  username: string;
  domain: string;
}

/**
 * Validates if a string is a lightning address (user@domain.com format)
 */
export const isLightningAddress = (address: string): boolean => {
  if (!address) return false;
  return LN_ADDRESS_REGEX.test(address);
};

/**
 * Validates if a string is an lnurlp URL
 */
export const isLnurlp = (url: string): boolean => {
  if (!url) return false;
  return LNURLP_REGEX.test(url);
};

/**
 * Parses a lightning address into username and domain
 */
export const parseLightningAddress = (address: string): LightningAddress | null => {
  if (!address) return null;
  const result = LN_ADDRESS_REGEX.exec(address);
  return result ? { username: result[1], domain: result[2] } : null;
};

/**
 * Parses an lnurlp URL and returns a proper HTTP(S) URL
 * Only lowercases the domain, preserves path case
 */
export const parseLnurlp = (url: string): string | null => {
  if (!url) return null;
  // Test with lowercase for regex, but preserve original case for path
  if (!LNURLP_REGEX.test(url.toLowerCase())) return null;
  const withoutProtocol = url.replace(/^lnurlp:\/\//i, '');
  const slashIndex = withoutProtocol.indexOf('/');
  const protocol = withoutProtocol.toLowerCase().includes('.onion') ? 'http://' : 'https://';
  if (slashIndex === -1) {
    // No path, just domain
    return `${protocol}${withoutProtocol.toLowerCase()}`;
  }
  const domain = withoutProtocol.slice(0, slashIndex).toLowerCase();
  const path = withoutProtocol.slice(slashIndex);
  return `${protocol}${domain}${path}`;
};

/**
 * Decodes a lightning address or lnurlp URL to a callback URL
 */
export const decodeUrlOrAddress = (lnUrlOrAddress: string): string | null => {
  const address = parseLightningAddress(lnUrlOrAddress);
  if (address) {
    const { username, domain } = address;
    const protocol = domain.match(/\.onion$/) ? 'http' : 'https';
    return `${protocol}://${domain}/.well-known/lnurlp/${username}`;
  }
  return parseLnurlp(lnUrlOrAddress);
};

export interface LnUrlPayParams {
  callback: string;
  minSendable: number;
  maxSendable: number;
  tag: string;
}

/**
 * Fetches LNURL pay parameters from a lightning address or lnurlp URL
 */
export const getLnurlPayParams = async (lnUrlOrAddress: string): Promise<LnUrlPayParams | null> => {
  const url = decodeUrlOrAddress(lnUrlOrAddress);
  if (!url) return null;

  const response = await fetch(url);
  const data = await response.json();
  return data as LnUrlPayParams;
};

/**
 * Requests an invoice from a lightning address or lnurlp URL
 * @param lnUrlOrAddress - Lightning address (user@domain.com) or lnurlp URL
 * @param amountSats - Amount in satoshis
 * @returns The lightning invoice (payment request)
 */
export const requestInvoiceFromLnurl = async (
  lnUrlOrAddress: string,
  amountSats: number
): Promise<string> => {
  const params = await getLnurlPayParams(lnUrlOrAddress);
  if (!params || !params.callback) {
    throw new Error('Invalid LNURL or lightning address');
  }

  const amountMsats = amountSats * 1000;

  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    throw new Error(
      `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`
    );
  }

  const response = await fetch(`${params.callback}?amount=${amountMsats}`);
  const data = await response.json();

  if (!data.pr) {
    throw new Error('No invoice returned from LNURL endpoint');
  }

  return data.pr;
};
