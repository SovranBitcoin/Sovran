import { facade } from 'nostr';

import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';

import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import type {
  FeedNotification,
  FeedNotificationActor,
  FeedNotificationsRequest,
  FeedNotificationsResult,
} from './feedClient';

// Pure shape bridge: facade ResolvedNotifications → app FeedNotificationsResult.
// Dependency-light so it's unit-testable without the facade-builder's RN chain.

/** Map the app notifications request to the facade NotificationsRequest. */
export function toFacadeNotificationsRequest(
  request: FeedNotificationsRequest
): facade.NotificationsRequest | null {
  // Only the server-shaped tabs route through the facade; APP (client-only) falls back.
  if (request.tab && request.tab !== 'ALL' && request.tab !== 'MENTIONS') return null;
  return {
    viewerPubkey: request.viewerPubkey,
    tab: request.tab as 'ALL' | 'MENTIONS' | undefined,
    policy: request.policy,
    replyScope: request.replyScope,
    grouped: request.grouped,
    since: request.since,
    limit: request.limit,
    refresh: request.refresh,
    signal: request.signal,
    timeoutMs: request.timeoutMs,
    cursor: request.until ? { createdAt: request.until, id: '' } : null,
  };
}

export function resolvedNotificationsToResult(
  page: facade.ResolvedNotifications
): FeedNotificationsResult {
  const notifications: FeedNotification[] = page.notifications.map((n) => {
    const targetEventId = typeof n.targetEventId === 'string' ? n.targetEventId : undefined;
    const targetEvent = n.targetEvent as FeedEvent | undefined;
    return {
      event: n.event as FeedEvent,
      reason: n.reason,
      actorVertexScore: n.actorVertexScore,
      ...(n.type ? { type: n.type } : {}),
      ...(typeof n.total === 'number' ? { total: n.total } : {}),
      ...(typeof n.totalCapped === 'boolean' ? { totalCapped: n.totalCapped } : {}),
      ...(n.sampleActors ? { sampleActors: n.sampleActors as FeedNotificationActor[] } : {}),
      ...(targetEventId ? { targetEventId } : {}),
      ...(targetEvent ? { targetEvent } : {}),
    };
  });

  // Dev-only: stamp each notification with the tier that served this page so
  // the row can badge its source (n/c/r), same as PostCard. Covers both the
  // triggering event (the row's badge key) and the target event (rendered as
  // the referenced-post preview). No-op in production.
  if (__DEV__) {
    const ids: string[] = [];
    for (const n of notifications) {
      ids.push(n.event.id);
      if (n.targetEvent) ids.push(n.targetEvent.id);
    }
    recordDebugTiers(ids, page.tier);
  }

  const metricsMap = new Map<string, NoteMetrics>();
  for (const [id, s] of Object.entries(page.stats)) {
    metricsMap.set(id, {
      likeCount: s.likes,
      repostCount: s.reposts,
      replyCount: s.replies,
      satsZapped: s.satsZapped,
    });
  }

  const profilesMap = new Map<string, ProfileInfo>(
    Object.entries(page.profiles).map(([pk, p]) => [
      pk,
      { name: p.name, ...(p.picture ? { picture: p.picture } : {}) },
    ])
  );
  const quotedEventsMap = new Map<string, FeedEvent>(
    Object.entries(page.quoted) as [string, FeedEvent][]
  );

  return {
    notifications,
    profilesMap,
    metricsMap,
    quotedEventsMap,
    paginationUntil: page.cursor?.createdAt ?? 0,
    // Conservative: only keep paging while a page returns items (the screen
    // dedupes by id, so this can't loop on a repeated tail).
    hasNextPage: notifications.length > 0 && page.cursor !== null,
  };
}
