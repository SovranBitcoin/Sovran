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
