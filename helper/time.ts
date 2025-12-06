/**
 * @fileoverview Time and date formatting utilities for the Sovran Bitcoin wallet
 *
 * This module provides comprehensive date and time formatting functions
 * for displaying timestamps, relative times, and localized date formats
 * throughout the application. It supports multiple languages and formats
 * based on user preferences.
 *
 * @example
 * // Import specific utilities
 * import { convertTime, getTimeAgo, formatDate } from '@/helper/time';
 *
 * // Format current time
 * const timestamp = convertTime(new Date()); // '10/07/2025 12:00:00'
 *
 * // Get relative time
 * const relative = getTimeAgo(new Date(Date.now() - 3600000)); // '1h'
 *
 * // Format date with localization
 * const formatted = formatDate('2025-01-15'); // 'January 15, 2025' (or localized)
 */

import { store } from 'redux/store';
import type { RootState } from 'redux/store/reducer';

/**
 * Converts a Date object to a formatted date-time string
 *
 * This function formats a Date object into a standardized date-time string
 * using the MM/DD/YYYY HH:MM:SS format with 24-hour time notation.
 * The formatting is consistent across all locales using the 'en-US' locale.
 *
 * @param date - The Date object to format
 * @returns A formatted date-time string in MM/DD/YYYY HH:MM:SS format
 *
 * @example
 * convertTime(new Date('2025-01-15T14:30:00')) // '01/15/2025 14:30:00'
 * convertTime(new Date()) // Current date and time formatted
 */
export function convertTime(date: Date): string {
  const dateFormat = {
    year: 'numeric' as const,
    month: '2-digit' as const,
    day: '2-digit' as const,
    hour: '2-digit' as const,
    minute: '2-digit' as const,
    second: '2-digit' as const,
    hour12: false, // Use 24-hour time format
  };

  const formatter = new Intl.DateTimeFormat('en-US', dateFormat);
  return formatter.format(date);
}

/**
 * Formats a date for display in a short format
 *
 * This function creates a compact date representation suitable for UI elements
 * where space is limited. It displays the month as a 3-letter abbreviation
 * and the day as a number without leading zeros.
 *
 * @param date - The Date object to format
 * @returns A short formatted date string (e.g., 'Oct 7', 'Dec 25')
 *
 * @example
 * formatCustomDate(new Date('2025-01-15')) // 'Jan 15'
 * formatCustomDate(new Date('2025-12-25')) // 'Dec 25'
 */
export function formatCustomDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Formats a date for display in a long format with localization support
 *
 * This function formats a date string or timestamp into a human-readable
 * long format using the user's preferred language setting. It displays
 * the full month name, day, and year in the appropriate locale format.
 *
 * @param date - The date to format (string, number timestamp, or Date object)
 * @returns A localized long format date string (e.g., 'October 7, 2025')
 *
 * @example
 * formatDate('2025-01-15') // 'January 15, 2025'
 * formatDate(1737000000000) // Formatted timestamp
 * formatDate(new Date()) // Current date in long format
 */
export function formatDate(date: string | number): string {
  const state = store.getState() as unknown as RootState;
  const language = state.settings?.settings.lang || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}
