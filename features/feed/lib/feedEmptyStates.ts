/**
 * @fileoverview Contextual feed empty-state selection.
 *
 * A Nostr feed goes blank for distinct reasons — the relays are unreachable,
 * the user follows nobody, or the relays simply returned nothing — and each
 * wants different copy and a different next action. This maps the feed's
 * loading/error/follow signals to a mode + its copy/CTA, so the empty state is
 * a guided next step rather than a dead end. Pure + unit-tested.
 */
export type FeedEmptyMode = 'loading' | 'unreachable' | 'no-follows' | 'empty';

export interface FeedEmptySignals {
  isLoading: boolean;
  hasError: boolean;
  rowCount: number;
  /** Whether the active feed is a following feed (vs an algorithmic one). */
  isFollowingFeed: boolean;
  followCount: number;
}

/** Picks the empty-state mode from the feed's current signals. */
export function selectFeedEmptyMode(signals: FeedEmptySignals): FeedEmptyMode {
  if (signals.isLoading) return 'loading';
  if (signals.hasError && signals.rowCount === 0) return 'unreachable';
  if (signals.isFollowingFeed && signals.followCount === 0) return 'no-follows';
  return 'empty';
}

interface FeedEmptyCopy {
  icon: string;
  title: string;
  subtitle: string;
  /** Label for the primary action, if any. */
  ctaLabel?: string;
  /** Which action the CTA performs. */
  ctaAction?: 'refresh' | 'find-people';
}

export const FEED_EMPTY_COPY: Record<Exclude<FeedEmptyMode, 'loading'>, FeedEmptyCopy> = {
  unreachable: {
    icon: 'mdi:wifi-off',
    title: "Can't reach your relays",
    subtitle: 'Your relays are slow or unreachable right now.',
    ctaLabel: 'Retry',
    ctaAction: 'refresh',
  },
  'no-follows': {
    icon: 'mdi:account-multiple-plus-outline',
    title: "You're not following anyone yet",
    subtitle: 'Find people to follow and your feed will fill up.',
    ctaLabel: 'Find people',
    ctaAction: 'find-people',
  },
  empty: {
    icon: 'mdi:message-text',
    title: 'No posts yet',
    subtitle: 'Pull down to refresh or try a different feed.',
    ctaLabel: 'Refresh',
    ctaAction: 'refresh',
  },
};
