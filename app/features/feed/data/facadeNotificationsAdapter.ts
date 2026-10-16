import { facade } from 'nostr';

import { recordDebugTiers } from '@/shared/stores/runtime/debugTierStore';

import type { FeedEvent, NoteMetrics, ProfileInfo } from '../components/nostr/feedTypes';
import type {
  FeedNotification,
  FeedNotificationActor,
  FeedNotificationsRequest,
  FeedNotificationsResult,
} from './feedClient';
import { mapFacadePageEnrichment } from './facadePageMaps';
import { feedEventsEqual, feedNotificationsEqual } from './feedNotificationEquality';

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
    ...(request.readId ? { readId: request.readId } : {}),
    ...(request.ownEventIds?.length ? { ownEventIds: request.ownEventIds } : {}),
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

  const { metricsMap, profilesMap, quotedEventsMap } = mapFacadePageEnrichment(page);

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

function profilesEqual(a: ProfileInfo, b: ProfileInfo): boolean {
  return a.name === b.name && a.picture === b.picture;
}

function metricsEqual(a: NoteMetrics, b: NoteMetrics): boolean {
  return (
    a.likeCount === b.likeCount &&
    a.repostCount === b.repostCount &&
    a.replyCount === b.replyCount &&
    a.satsZapped === b.satsZapped
  );
}

/** `previous` when it holds the same keys, in the same order, with equal values; else `next`. */
function reuseMap<V>(
  previous: Map<string, V>,
  next: Map<string, V>,
  equal: (a: V, b: V) => boolean
): Map<string, V> {
  if (previous.size !== next.size) return next;
  const previousEntries = previous.entries();
  for (const [key, value] of next) {
    const entry = previousEntries.next().value;
    if (!entry || entry[0] !== key || !equal(entry[1], value)) return next;
  }
  return previous;
}

/**
 * A session re-emits its whole snapshot whenever any source adds to it, and
 * `resolvedNotificationsToResult` mints every object afresh. One mapper per
 * session hands back the previous notification object, and the previous
 * enrichment map, wherever the new one says the same thing — so a snapshot that
 * changes one row changes one row's identity, not all of them. The value
 * returned is always deep-equal to what the plain adapter returns.
 */
export function createNotificationsResultMapper(): (
  page: facade.ResolvedNotifications
) => FeedNotificationsResult {
  let previous: FeedNotificationsResult | null = null;
  return (page) => {
    const mapped = resolvedNotificationsToResult(page);
    const last = previous;
    if (!last) {
      previous = mapped;
      return mapped;
    }
    const lastByEventId = new Map(last.notifications.map((n) => [n.event.id, n]));
    const result: FeedNotificationsResult = {
      ...mapped,
      notifications: mapped.notifications.map((n) => {
        const before = lastByEventId.get(n.event.id);
        return before && feedNotificationsEqual(before, n) ? before : n;
      }),
      profilesMap: reuseMap(last.profilesMap, mapped.profilesMap, profilesEqual),
      metricsMap: reuseMap(last.metricsMap, mapped.metricsMap, metricsEqual),
      quotedEventsMap: reuseMap(last.quotedEventsMap, mapped.quotedEventsMap, feedEventsEqual),
    };
    previous = result;
    return result;
  };
}
