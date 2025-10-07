import { store } from './redux/store';

/**
 * Converts a Date object to a formatted date-time string
 * Example: 10/07/2025 12:00:00
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
 * Example: Oct 7
 */
export function formatCustomDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/**
 * Formats a date for display in a long format
 * Example: October 7, 2025
 */
export function formatDate(date: string | number): string {
  const language = store.getState().settings?.settings.lang || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

/**
 * Converts a Date to a relative time string
 * Example: "2h", "3d", "01/15/2025"
 */
export function getTimeAgo(date: Date | number | string): string {
  const postDate = new Date(date);
  const now = new Date();

  // Calculate difference in milliseconds
  const diffMs = now.getTime() - postDate.getTime();

  // Convert to various units
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Return formatted string based on time difference
  if (diffDays >= 7) {
    // Format as MM/DD/YYYY for dates 7+ days ago
    const month = String(postDate.getMonth() + 1).padStart(2, '0');
    const day = String(postDate.getDate()).padStart(2, '0');
    const year = postDate.getFullYear();
    return `${month}/${day}/${year}`;
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
