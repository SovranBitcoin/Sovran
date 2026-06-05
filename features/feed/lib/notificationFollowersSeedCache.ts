import type { FeedNotification, FeedNotificationsResult } from '@/features/feed/data/feedClient';
import { emptyNotificationsResult } from '@/features/feed/lib/notificationResults';

type NotificationFollowersSeed = {
  notifications: FeedNotification[];
  result: FeedNotificationsResult | null;
};

const followerSeeds = new Map<string, NotificationFollowersSeed>();

export function seedNotificationFollowers(seed: NotificationFollowersSeed): string {
  const seedId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  followerSeeds.set(seedId, seed);
  return seedId;
}

export function takeNotificationFollowersSeed(seedId: string | undefined): FeedNotificationsResult {
  if (!seedId) return emptyNotificationsResult();
  const seed = followerSeeds.get(seedId);
  followerSeeds.delete(seedId);
  if (!seed) return emptyNotificationsResult();

  const base = seed.result ?? emptyNotificationsResult();
  const oldestSeedTimestamp =
    seed.notifications.length > 0
      ? Math.min(...seed.notifications.map((notification) => notification.event.created_at))
      : base.paginationUntil;

  return {
    notifications: seed.notifications,
    profilesMap: new Map(base.profilesMap),
    metricsMap: new Map(base.metricsMap),
    quotedEventsMap: new Map(base.quotedEventsMap),
    paginationUntil: oldestSeedTimestamp || base.paginationUntil,
  };
}
