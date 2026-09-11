/** Read-only public snapshot. Never pass these events to signing, publishing,
 * wallet operations, live entity caches, or persisted stores. */
import type {
  FeedEvent,
  ProfileInfo,
  NoteMetrics,
} from '@/features/feed/components/nostr/feedTypes';
import type { FeedNotificationsResult } from '@/features/feed/data/feedClient';
import type { RoutstrMessage } from '@/shared/stores/profile/routstrStore';
import { PUBLIC_DEMO_METADATA } from './mockPublicProfile';
import snapshot from './fixtures/publicDemoSnapshot.json';

const now = Date.now();
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
export const DEMO_AI_MESSAGES: RoutstrMessage[] = [
  {
    id: 'demo-ai-question',
    role: 'user',
    content: 'Explain ecash in simple terms.',
    timestamp: now - 120_000,
  },
  {
    id: 'demo-ai-answer',
    parentId: 'demo-ai-question',
    role: 'assistant',
    timestamp: now - 118_000,
    content:
      'Ecash is like digital cash you can hold in your wallet.\n\n• A mint issues tokens backed by funds it holds.\n• You can send tokens to someone else, much like handing over a banknote.\n• The recipient redeems them with the mint.\n\nChoose mints you trust: the mint holds the backing funds.',
  },
];
