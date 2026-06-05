import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';

export function emptyNotificationsResult(): FeedNotificationsResult {
  return {
    notifications: [],
    profilesMap: new Map(),
    metricsMap: new Map(),
    quotedEventsMap: new Map(),
    paginationUntil: 0,
  };
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

  const seen = new Set(previous.notifications.map((notification) => notification.event.id));
  const notifications = [...previous.notifications];
  for (const notification of next.notifications) {
    if (seen.has(notification.event.id)) continue;
    seen.add(notification.event.id);
    notifications.push(notification);
  }

  return {
    notifications,
    profilesMap: mergeMaps(previous.profilesMap, next.profilesMap),
    metricsMap: mergeMaps(previous.metricsMap, next.metricsMap),
    quotedEventsMap: mergeMaps(previous.quotedEventsMap, next.quotedEventsMap),
    paginationUntil: next.paginationUntil || previous.paginationUntil,
  };
}

function mergeMaps<K, V>(left: Map<K, V>, right: Map<K, V>): Map<K, V> {
  const merged = new Map(left);
  for (const [key, value] of right) merged.set(key, value);
  return merged;
}
