/**
 * @fileoverview String manipulation utilities for the Sovran Bitcoin wallet
 *
 * This module provides utility functions for common string operations
 * used throughout the application, such as truncation, formatting,
 * and text manipulation for display purposes.
 *
 * @example
 * // Import string utilities
 * import { truncateMiddle } from '@/helper/strings';
 *
 * // Truncate long strings for display
 * const truncated = truncateMiddle('very-long-string-that-needs-truncation', 5);
 * // Result: 'very-...cation'
 */

/**
 * Truncates a string by keeping the beginning and end, with ellipsis in the middle
 *
 * This function is useful for displaying long strings (like addresses, URLs, or IDs)
 * in UI components where space is limited. It preserves the most important parts
 * of the string (beginning and end) while indicating truncation with ellipsis.
 *
 * @param str - The string to truncate
 * @param n - Number of characters to keep from the beginning and end
 * @returns The truncated string with ellipsis in the middle, or original string if truncation not needed
 *
 * @example
 * // Basic truncation
 * truncateMiddle('hello-world-very-long-string', 5) // 'hello...string'
 *
 * // Short string (no truncation needed)
 * truncateMiddle('short', 3) // 'short'
 *
 * // Invalid inputs
 * truncateMiddle('', 5) // ''
 * truncateMiddle('test', -1) // 'test'
 */
export const truncateMiddle = (str: string, n: number): string => {
  // Check for invalid inputs
  if (!str || typeof str !== 'string' || n < 0) {
    return str;
  }

  // If total preserved characters would exceed string length, return original
  if (n * 2 >= str.length) {
    return str;
  }

  const ellipsis = '...';
  const startChunk = str.substring(0, n);
  const endChunk = str.substring(str.length - n);

  return `${startChunk}${ellipsis}${endChunk}`;
};
