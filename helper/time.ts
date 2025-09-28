import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { store } from './redux/store';

dayjs.extend(relativeTime);

/**
 * Converts a Date object to a formatted date-time string
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
 * Formats a date for display in a short format (e.g., "Jan 15")
 */
export function formatCustomDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Formats a date for display in a long format (e.g., "January 15, 2024")
 */
export function formatDate(date: string): string {
  const language = store.getState().settings?.settings.lang || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

/**
 * Converts a Unix timestamp to a relative time string (e.g., "2h", "3d", "Jan 15, 2024")
 */
export function getTimeAgo(created_at: number): string {
  const postDate = dayjs.unix(created_at);
  const now = dayjs();
  const diffSeconds = now.diff(postDate, 'second');
  const diffMinutes = now.diff(postDate, 'minute');
  const diffHours = now.diff(postDate, 'hour');
  const diffDays = now.diff(postDate, 'day');

  if (diffDays >= 7) {
    return postDate.format('MM/DD/YYYY');
  } else if (diffDays > 0) {
    return `${diffDays}d`;
  } else if (diffHours > 0) {
    return `${diffHours}h`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}m`;
  } else {
    return `${diffSeconds}s`;
  }
}

/**
 * Converts a Unix timestamp to a Date object
 */
export function unixToDate(timestamp: number): Date {
  return new Date(timestamp * 1000);
}

/**
 * Converts a Date object to a Unix timestamp
 */
export function dateToUnix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/**
 * Gets the current Unix timestamp
 */
export function getCurrentTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}
