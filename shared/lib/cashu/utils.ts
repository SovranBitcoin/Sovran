/**
 * @fileoverview Coco Cashu utility functions for Lightning Network and ecash operations
 *
 * @module shared/lib/cashu/utils
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
 * import { getMintInfo, isValidEcashToken, getLightningAmount } from '@/shared/lib/cashu/utils';
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

import { getDecodedToken, type ReceiveHistoryEntry } from '@cashu/coco-core';

import { decode } from '@gandlaf21/bolt11-decode';

import { log } from '../logger';

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
    log.debug('cashu.utils.validate_ecash_token', { valid: true, tokenLen: token.length });
    return true;
  } catch {
    log.debug('cashu.utils.validate_ecash_token', { valid: false, tokenLen: token.length });
    return false;
  }
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
    log.debug('cashu.utils.validate_lightning_invoice', { valid: true, invoiceLen: invoice.length });
    return true;
  } catch {
    log.debug('cashu.utils.validate_lightning_invoice', { valid: false, invoiceLen: invoice.length });
    return false;
  }
};

// ============================================================================
// LNURL Utilities (replaces lnurl-pay library which has React Native issues)
// ============================================================================

const LN_ADDRESS_REGEX =
  /^((?:[^<>()[\]\\.,;:\s@"]+(?:\.[^<>()[\]\\.,;:\s@"]+)*)|(?:".+"))@((?:\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(?:(?:[a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

const LNURLP_REGEX = /^lnurlp:\/\/([\w-]+\.)+[\w-]+(:\d{1,5})?(\/[\w-./?%&=]*)?$/;

interface LightningAddress {
  username: string;
  domain: string;
}

/**
 * Parses a lightning address into username and domain
 */
const parseLightningAddress = (address: string): LightningAddress | null => {
  if (!address) return null;
  const result = LN_ADDRESS_REGEX.exec(address);
  return result ? { username: result[1], domain: result[2] } : null;
};

/**
 * Parses an lnurlp URL and returns a proper HTTP(S) URL
 * Only lowercases the domain, preserves path case
 */
const parseLnurlp = (url: string): string | null => {
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
const decodeUrlOrAddress = (meltTarget: string): string | null => {
  const address = parseLightningAddress(meltTarget);
  if (address) {
    const { username, domain } = address;
    const protocol = domain.match(/\.onion$/) ? 'http' : 'https';
    return `${protocol}://${domain}/.well-known/lnurlp/${username}`;
  }
  return parseLnurlp(meltTarget);
};

interface LnUrlPayParams {
  callback: string;
  minSendable: number;
  maxSendable: number;
  tag: string;
}

/**
 * Fetches LNURL pay parameters from a lightning address or lnurlp URL
 */
const getLnurlPayParams = async (meltTarget: string): Promise<LnUrlPayParams | null> => {
  const url = decodeUrlOrAddress(meltTarget);
  if (!url) return null;

  const response = await fetch(url);
  const data = await response.json();
  return data as LnUrlPayParams;
};

/**
 * Requests an invoice from a lightning address or lnurlp URL
 * @param meltTarget - Lightning address (user@domain.com) or lnurlp URL
 * @param amountSats - Amount in satoshis
 * @returns The lightning invoice (payment request)
 */
export const requestInvoiceFromLnurl = async (
  meltTarget: string,
  amountSats: number
): Promise<string> => {
  log.info('cashu.utils.request_invoice_from_lnurl.start', { targetLen: meltTarget.length, amountSats });
  const params = await getLnurlPayParams(meltTarget);
  if (!params || !params.callback) {
    log.error('cashu.utils.request_invoice_from_lnurl.invalid_params', { hasParams: !!params, hasCallback: !!params?.callback });
    throw new Error('Invalid LNURL or lightning address');
  }

  const amountMsats = amountSats * 1000;

  if (amountMsats < params.minSendable || amountMsats > params.maxSendable) {
    log.error('cashu.utils.request_invoice_from_lnurl.amount_out_of_range', { amountMsats, minSendable: params.minSendable, maxSendable: params.maxSendable });
    throw new Error(
      `Amount must be between ${params.minSendable / 1000} and ${params.maxSendable / 1000} sats`
    );
  }

  const response = await fetch(`${params.callback}?amount=${amountMsats}`);
  const data = await response.json();

  if (!data.pr) {
    log.error('cashu.utils.request_invoice_from_lnurl.no_invoice', { amountSats });
    throw new Error('No invoice returned from LNURL endpoint');
  }

  log.info('cashu.utils.request_invoice_from_lnurl.success', { amountSats, invoiceLen: data.pr.length });
  return data.pr;
};

// ============================================================================
// Ecash Token Helpers
// ============================================================================

/**
 * Sums the amounts of all proofs in an array.
 * Eliminates repeated `.reduce((sum, p) => sum + p.amount, 0)` across the codebase.
 */
function sumProofAmounts(proofs: ReadonlyArray<{ amount: number }>): number {
  let total = 0;
  for (const p of proofs) total += p.amount;
  return total;
}

/**
 * Extracts the amount in sats from an ecash token.
 */
export function getEcashTokenAmount(token: string): number | undefined {
  try {
    const decoded = getDecodedToken(token);
    const amount = sumProofAmounts(decoded.proofs);
    log.debug('cashu.utils.get_ecash_token_amount', { amount, proofCount: decoded.proofs.length, mint: decoded.mint });
    return amount;
  } catch {
    log.warn('cashu.utils.get_ecash_token_amount.decode_failed', { tokenLen: token.length });
    return undefined;
  }
}

/**
 * Extracts the P2PK public key from proofs, if any proof uses P2PK locking.
 * Returns the first P2PK data field found, or null.
 */
function extractP2PKPubkey(proofs: ReadonlyArray<{ secret: string }>): string | null {
  for (const proof of proofs) {
    try {
      const parsed = JSON.parse(proof.secret);
      if (Array.isArray(parsed) && parsed[0] === 'P2PK' && parsed[1]?.data) {
        return parsed[1].data as string;
      }
    } catch {
      // not a structured secret
    }
  }
  return null;
}

/**
 * Builds a `ReceiveHistoryEntry` from a decoded token.
 *
 * Centralises the pattern that was duplicated in ReceiveScreen and UserMessagesScreen —
 * each constructing the same shape manually.
 *
 * @param rawToken  The original encoded token string (stored in metadata for re-encoding)
 * @param unitOverride  Explicit unit; falls back to `decodedToken.unit ?? 'sat'`
 */
export function buildReceiveHistoryEntry(
  rawToken: string,
  unitOverride?: string
): ReceiveHistoryEntry {
  log.info('cashu.utils.build_receive_history_entry', { tokenLen: rawToken.length, unitOverride });
  const decodedToken = getDecodedToken(rawToken);
  const p2pkPubkey = extractP2PKPubkey(decodedToken.proofs);
  const amount = sumProofAmounts(decodedToken.proofs);
  log.debug('cashu.utils.build_receive_history_entry.decoded', { amount, proofCount: decodedToken.proofs.length, mint: decodedToken.mint, hasP2pk: !!p2pkPubkey });
  return {
    id: `receive-${Date.now()}`,
    type: 'receive',
    amount: sumProofAmounts(decodedToken.proofs),
    unit: unitOverride ?? decodedToken.unit ?? 'sat',
    mintUrl: decodedToken.mint,
    createdAt: Date.now(),
    metadata: {
      rawToken,
      ...(p2pkPubkey ? { p2pkPubkey } : {}),
    },
    token: decodedToken,
  };
}
