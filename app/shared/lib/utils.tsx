/**
 * @fileoverview Utility functions for the Sovran application
 *
 * This module contains various utility functions used throughout the application,
 * including number formatting, Lightning Network payment request handling,
 * and React provider composition.
 */

import React from 'react';

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
function formatExpiryCountdown(secondsRemaining: number): string | null {
  if (secondsRemaining <= 0) return null;
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;
  if (hours > 0) return `expires in ${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `expires in ${minutes}m ${seconds}s`;
  return `expires in ${seconds}s`;
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
  const expiry = info.expirySec ?? 3600;
  const timestamp = info.timestampSec ?? 0;
  const expiryTime = (timestamp + expiry) * 1000;

  return Date.now() > expiryTime;
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
  const expiry = info.expirySec ?? 3600;
  const timestamp = info.timestampSec ?? 0;
  const expiryTime = (timestamp + expiry) * 1000;

  return formatExpiryCountdown(Math.floor((expiryTime - Date.now()) / 1000));
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

/**
 * Composes multiple React providers into a single provider component.
 *
 * Given an array of providers, this utility nests them so that children are rendered
 * within all providers, in the order provided. Supports both direct component references
 * and component-props tuples for providers that need configuration.
 *
 * @example
 * // Direct component references (clean API)
 * const AppProviders = compose([ProviderA, ProviderB, ProviderC]);
 *
 * // Mixed approach (tuples + direct)
 * const AppProviders = compose([
 *   [NostrProvider, { relayUrls: RELAY_URLS }],
 *   [WhitenoiseProvider, { accountIndex }],
 *   ThemeProvider,  // Direct component (no props needed)
 *   PricelistProvider, // Automatically wrapped in Fragment for single-child requirement
 * ]);
 *
 * <AppProviders>
 *   <App />
 * </AppProviders>
 */
export const compose = (
  providers: (
    | React.FC<{ children: React.ReactNode }>
    | React.ComponentType<any>
    | [React.ComponentType<any>, Record<string, any>]
  )[]
): React.FC<{ children: React.ReactNode }> => {
  // Normalise ONCE, at compose time. Deriving the wrapper per render — as this
  // used to — minted a fresh component type on every parent render, and React
  // unmounts a subtree whose element type changed: every re-render of the
  // owning layout tore down and rebuilt the whole provider stack beneath the
  // first configured provider (relay sockets, wallet, price feed included).
  const entries = providers.map((provider) =>
    Array.isArray(provider) && provider.length === 2
      ? { Component: provider[0], props: provider[1] as Record<string, unknown> }
      : { Component: provider as React.ComponentType<any>, props: {} }
  );

  // No Fragment normalisation: `children: React.ReactNode` already accepts a
  // sibling list, and no provider in either stack uses `Children.only`.
  const ComposedProvider = ({ children }: { children: React.ReactNode }) =>
    entries.reduceRight<React.ReactNode>(
      (tree, { Component, props }) => <Component {...props}>{tree}</Component>,
      children
    );

  ComposedProvider.displayName = 'ComposedProvider';
  return ComposedProvider;
};
