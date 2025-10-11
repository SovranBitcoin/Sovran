/**
 * @fileoverview Utility functions for the Sovran application
 *
 * This module contains various utility functions used throughout the application,
 * including number formatting, Lightning Network payment request handling,
 * and Tailwind CSS class merging utilities.
 */

import { MintHistoryEntry } from 'coco-cashu-core';
import { decode } from '@gandlaf21/bolt11-decode';
import _ from 'lodash';
import { MeltQuoteResponse } from '@cashu/cashu-ts';

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Formats a number with appropriate suffixes (k, m, b) for large numbers
 *
 * This function converts large numbers into more readable format by adding
 * appropriate suffixes: 'k' for thousands, 'm' for millions, and 'b' for billions.
 * Numbers less than 1000 are returned as-is.
 *
 * @param num - The number to format (must be a positive number)
 * @returns A formatted string with appropriate suffix, removing trailing '.0' if present
 *
 * @example
 * formatNumber(1500) // '1.5k'
 * formatNumber(2500000) // '2.5m'
 * formatNumber(1000000000) // '1b'
 * formatNumber(500) // '500'
 * formatNumber(1000) // '1k' (removes trailing .0)
 */
export function formatNumber(num: number): string {
  if (num >= 1000000000) {
    return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'b';
  } else if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  } else {
    return num.toString();
  }
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
export function mintHistoryEntryExpired(historyEntry: MintHistoryEntry): boolean {
  try {
    if (!historyEntry.paymentRequest) {
      return false;
    }
    const paymentRequest = decode(historyEntry.paymentRequest);

    const expiry = paymentRequest.expiry ?? 3600;
    const timestamp = _.find(paymentRequest.sections, { name: 'timestamp' })?.value ?? 0;
    const expiryTime = (timestamp + expiry) * 1000;

    console.log(Date.now(), expiryTime);
    return Date.now() > expiryTime;
  } catch (error) {
    console.error('Error decoding payment request:', error);
    return false;
  }
}

/**
 * Checks if a melt quote has expired based on its expiry timestamp
 *
 * This function checks if the current time exceeds the melt quote's expiry time.
 * If no expiry timestamp exists, it returns false (not expired).
 *
 * @param meltQuote - The melt quote response containing the expiry timestamp
 * @returns True if the melt quote has expired, false if not expired or if no expiry exists
 *
 * @example
 * const quote = { expiry: 1234567890, ... };
 * const isExpired = meltQuoteExpired(quote);
 * if (isExpired) {
 *   // Handle expired melt quote - show refresh component
 * }
 */
export function meltQuoteExpired(meltQuote: MeltQuoteResponse): boolean {
  if (!meltQuote.expiry) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return now > meltQuote.expiry;
}

/**
 * Utility function to merge Tailwind CSS classes with proper conflict resolution
 *
 * This function combines clsx for conditional class handling and tailwind-merge
 * for intelligent Tailwind CSS class merging. It resolves conflicts by keeping
 * the last conflicting class and removes duplicates.
 *
 * @param inputs - Variable number of class values to merge (strings, objects, arrays, etc.)
 * @returns A merged string of CSS classes with conflicts resolved and duplicates removed
 *
 * @example
 * // Basic usage
 * cn('px-2 py-1', 'px-4') // 'py-1 px-4' (px-2 is overridden by px-4)
 *
 * // Conditional classes
 * cn('text-red-500', { 'text-blue-500': isBlue }) // 'text-blue-500' if isBlue is true
 *
 * // Complex conditional logic
 * cn('base-class', condition && 'conditional-class', isActive && 'active-class')
 *
 * // Arrays and mixed types
 * cn(['class1', 'class2'], { 'class3': true }, 'class4')
 *
 * @see {@link https://github.com/dcastil/tailwind-merge} tailwind-merge documentation
 * @see {@link https://github.com/lukeed/clsx} clsx documentation
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
