import { MintHistoryEntry } from 'coco-cashu-core';
import { decode } from '@gandlaf21/bolt11-decode';
import _ from 'lodash';

/**
 * Formats a number with appropriate suffixes (k, m, b) for large numbers
 * @param num - The number to format
 * @returns Formatted string with appropriate suffix
 *
 * @example
 * formatNumber(1500) // "1.5k"
 * formatNumber(1000000) // "1m"
 * formatNumber(1500000000) // "1.5b"
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
 * @param historyEntry - The mint history entry to check
 * @returns True if the payment request has expired
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
