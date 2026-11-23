/** Read-only public snapshot. Never pass these events to signing, publishing,
 * wallet operations, live entity caches, or persisted stores. */
import type {
  FeedEvent,
  ProfileInfo,
  NoteMetrics,
} from '@/features/feed/components/nostr/feedTypes';
import type { FeedNotificationsResult } from '@/features/feed/data/feedClient';
import { PUBLIC_DEMO_METADATA } from './mockPublicProfile';
import snapshot from './fixtures/publicDemoSnapshot.json';

export const DEMO_PROFILES = new Map<string, ProfileInfo>(
  [...PUBLIC_DEMO_METADATA].map(([pubkey, metadata]) => [
    pubkey,
    {
      name: metadata.displayName || metadata.name || pubkey.slice(0, 8),
      picture: metadata.picture,
    },
  ])
);
export const DEMO_FEED: FeedEvent[] = snapshot.feed;
export const DEMO_METRICS = new Map<string, NoteMetrics>(Object.entries(snapshot.metrics));
export const DEMO_NOTIFICATIONS: FeedNotificationsResult = {
  notifications: snapshot.notifications.map(({ event, reason, targetEventId }) => ({
    event,
    reason,
    // No invented trust/reputation score; these rows were reviewed individually.
    actorVertexScore: 0,
    targetEventId: targetEventId ?? undefined,
    targetEvent: snapshot.targets.find((target) => target.id === targetEventId),
  })),
  profilesMap: DEMO_PROFILES,
  metricsMap: DEMO_METRICS,
  quotedEventsMap: new Map(),
  paginationUntil: 0,
  hasNextPage: false,
};

export const DEMO_MEDIA_SOURCES: Readonly<Record<string, number>> = {
  'https://blossom.primal.net/ab4028a4b2d17241fe65fb15e2f53e32430772b8d8574fc3b601ed42fb32adbf.jpg': require('../../../assets/demo/feed-188/image.png'),
  'https://image.nostr.build/73a0a70de41c73241f10ab42edddeab0f2f6566a3b760a9c4abf46df797f41c2.jpg': require('../../../assets/demo/feed-159/image.png'),
  'https://i.nostr.build/UQ4RgnqRPRLd76eQJAeajy.jpg': require('../../../assets/demo/feed-24/image.png'),
};
