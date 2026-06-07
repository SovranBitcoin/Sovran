import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';

export function emptyNotificationsResult(): FeedNotificationsResult {
  return {
    notifications: [],
    profilesMap: new Map(),
    metricsMap: new Map(),
    quotedEventsMap: new Map(),
    paginationUntil: 0,
    hasNextPage: false,
  };
}

// Identity used to dedupe across pages. Grouped nodes (follow/repost/reaction/
// zap) collapse a whole post/relationship, so two pages can carry the same group
// with different representative events — dedupe those by reason+target, and
// everything else by event id.
function notificationDedupeKey(notification: FeedNotification): string {
  if (notification.type === 'group') {
    const target = notification.targetEventId ?? notification.targetEvent?.id ?? 'profile';
    return notification.reason === 'follow'
      ? 'group:follow'
      : `group:${notification.reason}:${target}`;
  }
  return `single:${notification.event.id}`;
}

export function filterNotificationsResult(
  result: FeedNotificationsResult,
  predicate: (notification: FeedNotification) => boolean
): FeedNotificationsResult {
  return {
    ...result,
    notifications: result.notifications.filter(predicate),
  };
}

export function mergeNotificationsResult(
  previous: FeedNotificationsResult | null,
  next: FeedNotificationsResult
): FeedNotificationsResult {
  if (!previous) return next;

  const seen = new Set(previous.notifications.map(notificationDedupeKey));
  const notifications = [...previous.notifications];
  for (const notification of next.notifications) {
    const key = notificationDedupeKey(notification);
    if (seen.has(key)) continue;
    seen.add(key);
    notifications.push(notification);
  }

  return {
    notifications,
    profilesMap: mergeMaps(previous.profilesMap, next.profilesMap),
    metricsMap: mergeMaps(previous.metricsMap, next.metricsMap),
    quotedEventsMap: mergeMaps(previous.quotedEventsMap, next.quotedEventsMap),
    paginationUntil: next.paginationUntil || previous.paginationUntil,
    hasNextPage: next.hasNextPage,
  };
}

function mergeMaps<K, V>(left: Map<K, V>, right: Map<K, V>): Map<K, V> {
  const merged = new Map(left);
  for (const [key, value] of right) merged.set(key, value);
  return merged;
}
