/**
 * Date and time formatting utilities for user-facing display.
 *
 * Single source of truth for every datetime string rendered to the user.
 * Two functions, each with a constrained `style` union — the constrained
 * names are deliberate: opaque options bags drift, named styles stay
 * consistent across screens.
 *
 *   formatDate(input, style)      // absolute timestamps
 *   formatRelative(input, style)  // "ago" / day-anchored timestamps
 *
 * **Locale resolution.** Device locale (iOS / Android system preference)
 * is the default — so an American user sees `Mar 16, 2026, 3:42 PM`, a
 * British user sees `16 Mar 2026, 15:42`, a German user sees
 * `16. März 2026, 15:42`, etc. The in-app `settingsStore.language`
 * preference overrides the device locale only when the user has
 * explicitly chosen a non-default language; otherwise it falls through
 * so we don't override the device's region (en-GB vs en-US, etc.).
 *
 * `Intl` formatter instances are cached per `(locale, optionsKey)` so
 * high-frequency surfaces (feed, chat, transactions list) don't
 * re-allocate on every render.
 *
 * See `../.agents/skills/sovran-data/references/dates.md` for guidance on which style to pick.
 */

import * as Localization from 'expo-localization';

import { useSettingsStore } from '@/shared/stores/global/settingsStore';

type DateInput = Date | number | string;

type AbsoluteDateStyle =
  /** Time of day. en-US: `3:42 PM`. en-GB / de-DE: `15:42`. */
  | 'time'
  /** Compact short date. en-US: `Mar 16, 2026`. en-GB: `16 Mar 2026`. */
  | 'short-date'
  /** Long date with month spelled out. en-US: `March 16, 2026`. */
  | 'long-date'
  /** Short date + time. en-US: `Mar 16, 2026, 3:42 PM`. */
  | 'short-date-time'
  /** Machine-readable, locale-frozen `MM/DD/YYYY HH:MM:SS` (en-US, 24h).
   *  Use only for debug screens, transaction-state timelines that need
   *  second precision, and recovery export rows where the string has to
   *  round-trip identically across devices. */
  | 'iso';

type RelativeDateStyle =
  /** `Intl.RelativeTimeFormat` verbose form: `5 minutes ago`, `yesterday`,
   *  `in 3 days`. Use for presence indicators and one-shot timestamps
   *  where the label has room to breathe. */
  | 'verbose'
  /** Compact dense form: `now`, `5m ago`, `3h ago`, `2d ago`, `1w ago`,
   *  then a short locale-aware date for older. The English abbreviations
   *  are intentional — feed/post cards rely on each label fitting in one
   *  short line. */
  | 'compact'
  /** Chat bubble: locale time today, `Yesterday` up to 48h, short date
   *  older. Shared by every chat surface so bubbles read consistently. */
  | 'chat-bubble'
  /** Conversation-list row: `Today at HH:MM`, `Yesterday at HH:MM`, full
   *  short date+time older. */
  | 'conversation-list';

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

/**
 * Resolve the active BCP-47 locale tag.
 *
 * The settingsStore default is the literal string `'en'`. We treat that as
 * "user hasn't customised" and fall through to the device locale — which
 * is region-aware (`en-US` vs `en-GB` vs `en-AU`), and is what makes the
 * date format match the user's iOS/Android preferences.
 *
 * If the user has explicitly set a non-default app language (e.g. `'de'`,
 * `'ja'`), honor it — that's an intentional override. Empty string
 * collapses to device locale too.
 */
function resolveLocale(): string {
  const userPref = useSettingsStore.getState().language;
  if (userPref && userPref !== 'en') return userPref;
  const deviceTag = Localization.getLocales()[0]?.languageTag;
  return deviceTag || userPref || 'en';
}

const dtCache = new Map<string, Intl.DateTimeFormat>();
const rtfCache = new Map<string, Intl.RelativeTimeFormat | null>();

function getDateTimeFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = locale + '|' + JSON.stringify(options);
  let f = dtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dtCache.set(key, f);
  }
  return f;
}

function getRelativeTimeFormat(locale: string): Intl.RelativeTimeFormat | null {
  if (rtfCache.has(locale)) return rtfCache.get(locale) ?? null;
  try {
    const f = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    rtfCache.set(locale, f);
    return f;
  } catch {
    rtfCache.set(locale, null);
    return null;
  }
}

const ABSOLUTE_OPTIONS: Record<Exclude<AbsoluteDateStyle, 'iso'>, Intl.DateTimeFormatOptions> = {
  time: { hour: '2-digit', minute: '2-digit' },
  'short-date': { year: 'numeric', month: 'short', day: 'numeric' },
  'long-date': { year: 'numeric', month: 'long', day: 'numeric' },
  'short-date-time': {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
};

const ISO_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

/**
 * Format an absolute timestamp. The output respects the user's iOS/Android
 * regional preferences via `expo-localization` (or the in-app language
 * override when set).
 */
export function formatDate(input: DateInput, style: AbsoluteDateStyle): string {
  const date = toDate(input);
  if (style === 'iso') return getDateTimeFormat('en-US', ISO_OPTIONS).format(date);
  return getDateTimeFormat(resolveLocale(), ABSOLUTE_OPTIONS[style]).format(date);
}

function formatVerboseRelative(timestampMs: number, locale: string): string {
  const delta = Date.now() - timestampMs;
  const abs = Math.abs(delta);
  const isPast = delta >= 0;

  const seconds = Math.floor(abs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';

  const rtf = getRelativeTimeFormat(locale);
  if (rtf) {
    if (days > 0) return rtf.format(isPast ? -days : days, 'day');
    if (hours > 0) return rtf.format(isPast ? -hours : hours, 'hour');
    return rtf.format(isPast ? -minutes : minutes, 'minute');
  }
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${minutes}m ago`;
}

function formatCompactRelative(timestampMs: number, locale: string): string {
  const diff = (Date.now() - timestampMs) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;
  return getDateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
    new Date(timestampMs)
  );
}

function formatChatBubble(timestampMs: number): string {
  const date = new Date(timestampMs);
  const diffHours = (Date.now() - date.getTime()) / 3_600_000;
  if (diffHours < 24) return formatDate(date, 'time');
  if (diffHours < 48) return 'Yesterday';
  return formatDate(date, 'short-date');
}

function formatConversationList(timestampMs: number): string {
  const date = new Date(timestampMs);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `Today at ${formatDate(date, 'time')}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `Yesterday at ${formatDate(date, 'time')}`;
  }
  return formatDate(date, 'short-date-time');
}

/**
 * Format a relative-or-anchored timestamp. Accepts unix milliseconds,
 * a `Date`, or anything `new Date(input)` parses; non-millisecond inputs
 * are coerced first.
 */
export function formatRelative(input: DateInput, style: RelativeDateStyle): string {
  const ms = input instanceof Date ? input.getTime() : new Date(input).getTime();
  switch (style) {
    case 'verbose':
      return formatVerboseRelative(ms, resolveLocale());
    case 'compact':
      return formatCompactRelative(ms, resolveLocale());
    case 'chat-bubble':
      return formatChatBubble(ms);
    case 'conversation-list':
      return formatConversationList(ms);
  }
}
