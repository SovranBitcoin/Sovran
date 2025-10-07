import { MintHistoryEntry } from 'coco-cashu-core';
import { decode } from '@gandlaf21/bolt11-decode';
import _ from 'lodash';

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Formats a number with appropriate suffixes (k, m, b) for large numbers
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

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
