/**
 * @fileoverview Utility functions for the Sovran application
 *
 * This module contains various utility functions used throughout the application,
 * including number formatting and Lightning Network payment request handling.
 */

import type { MeltQuoteBolt11Response } from '@cashu/cashu-ts';
import { decodeBolt11Invoice } from 'wallet';

import type { HistoryEntry } from '@cashu/coco-core';
import { log } from './logger';

type AnyMintHistoryEntry = Extract<HistoryEntry, { type: 'mint' }>;

/**
 * Countdown for an expiring quote or invoice — "expires in 1h 4m 9s", dropping
 * the leading units once they reach zero, and `null` once the deadline has
 * passed so a caller renders nothing rather than a frozen "expires in 0s".
 *
 * Deliberately here rather than in `shared/lib/date` (the usual home for
 * formatting): both callers are in this file, and `date` pulls in the settings
 * store, so every component suite that mocks it hand-lists its exports — moving
 * this there makes those factories silently return `undefined` for it.
 */
function formatCountdown(secondsRemaining: number, verb: string): string | null {
  if (secondsRemaining <= 0) return null;
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;
  if (hours > 0) return `${verb} in ${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${verb} in ${minutes}m ${seconds}s`;
  return `${verb} in ${seconds}s`;
}

function formatExpiryCountdown(secondsRemaining: number): string | null {
  return formatCountdown(secondsRemaining, 'expires');
}

/**
 * "unlocks in 3h 2m 1s" for a P2PK lock that has not opened yet, or null once
 * it has. Deliberately NOT "expires": a lock opening is not a deadline
 * passing, and under NUT-11 the two have opposite consequences.
 */
export function getTimeUntilUnlock(
  unlockAtMs: number | null | undefined,
  currentTimeMs?: number
): string | null {
  if (!unlockAtMs) return null;
  const remainingSec = Math.floor((unlockAtMs - (currentTimeMs ?? Date.now())) / 1000);
  return formatCountdown(remainingSec, 'unlocks');
}

/** Outgoing = ecash send or Lightning melt */
export function isOutgoingTransaction(entry: Pick<HistoryEntry, 'type'>): boolean {
  return entry.type === 'send' || entry.type === 'melt';
}

/**
 * Checks if a mint history entry has expired based on its payment request
 *
 * This function decodes the Lightning Network payment request from the history entry
 * and checks if the current time exceeds the expiry time. If no payment request
 * exists or decoding fails, it returns false (not expired).
 *
 * @param historyEntry - The mint history entry containing the payment request
 * @returns True if the entry has expired, false if not expired or if no payment request exists
 * @throws Will log an error to console if payment request decoding fails, but returns false
 *
 * @example
 * const entry = { paymentRequest: 'lnbc...', ... };
 * const isExpired = mintHistoryEntryExpired(entry);
 * if (isExpired) {
 *   // Handle expired entry - remove from UI or show warning
 * }
 */
export function mintHistoryEntryExpired(historyEntry: AnyMintHistoryEntry): boolean {
  if (!historyEntry.paymentRequest) {
    return false;
  }
  const info = decodeBolt11Invoice(historyEntry.paymentRequest);
  if (!info) {
    log.error('utils.decode_payment_request_failed', {});
    return false;
  }
  const expirySec = info.expirySec ?? 3600;
  const timestampSec = info.timestampSec ?? 0;
  const expiresAt = (timestampSec + expirySec) * 1000;

  return Date.now() > expiresAt;
}

/**
 * Gets the time remaining until a mint history entry expires
 *
 * @param historyEntry - The mint history entry containing the payment request
 * @returns Formatted string like "expires in 14m 32s" or null if no expiry or already expired
 */
export function getMintHistoryEntryTimeUntilExpiry(
  historyEntry: AnyMintHistoryEntry
): string | null {
  if (!historyEntry.paymentRequest) {
    return null;
  }
  const info = decodeBolt11Invoice(historyEntry.paymentRequest);
  if (!info) {
    log.error('utils.expiry_calc_failed', {});
    return null;
  }
  const expirySec = info.expirySec ?? 3600;
  const timestampSec = info.timestampSec ?? 0;
  const expiresAt = (timestampSec + expirySec) * 1000;

  return formatExpiryCountdown(Math.floor((expiresAt - Date.now()) / 1000));
}

/**
 * Accepts an optional `currentTimeMs` for ticker-driven UIs (e.g. countdown timers).
 * Falls back to Date.now() when omitted.
 */
export function meltQuoteExpired(
  meltQuote: MeltQuoteBolt11Response,
  currentTimeMs?: number
): boolean {
  if (!meltQuote.expiry) return false;
  const nowSec = Math.floor((currentTimeMs ?? Date.now()) / 1000);
  return nowSec > meltQuote.expiry;
}

/**
 * Returns a human-readable countdown string like "expires in 14m 32s",
 * or null if no expiry or already expired.
 * Accepts an optional `currentTimeMs` for ticker-driven UIs.
 */
export function getMeltQuoteTimeUntilExpiry(
  meltQuote: MeltQuoteBolt11Response,
  currentTimeMs?: number
): string | null {
  if (!meltQuote.expiry) return null;
  const nowSec = Math.floor((currentTimeMs ?? Date.now()) / 1000);
  return formatExpiryCountdown(meltQuote.expiry - nowSec);
}
