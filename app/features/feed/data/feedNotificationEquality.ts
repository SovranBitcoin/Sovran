import type { FeedEvent } from '../components/nostr/feedTypes';
import type { FeedNotification, FeedNotificationActor } from './feedClient';

// A Nostr event id is the hash of its content, so equal ids are equal events.
export function feedEventsEqual(a: FeedEvent | undefined, b: FeedEvent | undefined): boolean {
  return a === b || (!!a && !!b && a.id === b.id);
}

function actorsEqual(
  a: readonly FeedNotificationActor[] | undefined,
  b: readonly FeedNotificationActor[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((actor, index) => {
    const other = b[index]!;
    return (
      actor.pubkey === other.pubkey &&
      actor.eventId === other.eventId &&
      actor.createdAt === other.createdAt &&
      actor.actorVertexScore === other.actorVertexScore
    );
  });
}

/** True when two notifications would render, group and open identically. */
export function feedNotificationsEqual(a: FeedNotification, b: FeedNotification): boolean {
  if (a === b) return true;
  return (
    feedEventsEqual(a.event, b.event) &&
    feedEventsEqual(a.targetEvent, b.targetEvent) &&
    a.targetEventId === b.targetEventId &&
    a.reason === b.reason &&
    a.actorVertexScore === b.actorVertexScore &&
    a.type === b.type &&
    a.total === b.total &&
    a.totalCapped === b.totalCapped &&
    actorsEqual(a.sampleActors, b.sampleActors)
  );
}
