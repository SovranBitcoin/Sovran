/** Time and date formatting utilities. */

import { useSettingsStore } from '@/shared/stores/global/settingsStore';

/** MM/DD/YYYY HH:MM:SS in 24-hour format, always en-US locale. */
export function convertTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Localized long date using the user's language preference from settingsStore. */
export function formatDate(date: string | number): string {
  const language = useSettingsStore.getState().language || 'en';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(date));
}

/** `"just now"`, `"2m ago"`, `"3h ago"`, `"5d ago"` — compact relative time.
 *  Uses `Intl.RelativeTimeFormat` when available so strings localise with the
 *  user's language; falls back to the compact abbreviations above. */
export function relativeTime(timestampMs: number, locale?: string): string {
  const lang = locale ?? useSettingsStore.getState().language ?? 'en';
  const delta = Date.now() - timestampMs;
  const abs = Math.abs(delta);
  const isPast = delta >= 0;

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';

  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
    if (days > 0) return rtf.format(isPast ? -days : days, 'day');
    if (hours > 0) return rtf.format(isPast ? -hours : hours, 'hour');
    return rtf.format(isPast ? -minutes : minutes, 'minute');
  } catch {
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return `${minutes}m ago`;
  }
}
