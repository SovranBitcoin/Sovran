import type { FeedNotification, FeedNotificationActor } from '@/features/feed/data/feedClient';

type BatchableNotificationReason = 'follow' | 'repost' | 'reaction' | 'zap';

export type NotificationListItem =
  | {
      type: 'single';
      id: string;
      notification: FeedNotification;
    }
  | {
      type: 'group';
      id: string;
      reason: BatchableNotificationReason;
      /** Avatar/seed members. For server groups these are the representative plus
       *  synthesised sample actors; for client grouping they are the real run. */
      notifications: FeedNotification[];
      /** True member count (server total, which can exceed the sampled members). */
      total: number;
      /** Server hit its window cap — render the count as "N+". */
      totalCapped?: boolean;
    }
  | {
      /** Synthetic, client-injected "thanks for downloading" card, pinned to the
       *  top of the ALL tab. Carries the install + terms-agreed dates. */
      type: 'welcome';
      id: string;
      installDate: number | null;
      termsDate: string | null;
    };

function batchableReason(reason: string): BatchableNotificationReason | null {
  if (reason === 'follow' || reason === 'repost' || reason === 'reaction' || reason === 'zap') {
    return reason;
  }
  return null;
}

function batchKeyFor(notification: FeedNotification, reason: BatchableNotificationReason): string {
  if (reason === 'follow') return 'follow';
  return notification.targetEventId ?? notification.targetEvent?.id ?? notification.event.id;
}

// A minimal FeedNotification standing in for a sampled group member, so the
// avatar cluster can render its pubkey without the server sending full events.
function syntheticActorNotification(
  actor: FeedNotificationActor,
  reason: string
): FeedNotification {
  return {
    event: {
      id: actor.eventId,
      pubkey: actor.pubkey,
      kind: 0,
      content: '',
      tags: [],
      created_at: actor.createdAt,
    },
    reason,
    actorVertexScore: actor.actorVertexScore ?? 0,
  };
}

export function buildNotificationListItems(
  notifications: readonly FeedNotification[]
): NotificationListItem[] {
  const out: NotificationListItem[] = [];
  let index = 0;

  while (index < notifications.length) {
    const notification = notifications[index];
    if (!notification) break;

    // Server-grouped node: one item already represents the whole group, with the
    // representative event plus sampled actors and an exact/capped total.
    if (notification.type === 'group') {
      const reason = batchableReason(notification.reason);
      if (reason) {
        const sample = notification.sampleActors ?? [];
        const members = [
          notification,
          ...sample.slice(1).map((actor) => syntheticActorNotification(actor, notification.reason)),
        ];
        const total = notification.total ?? members.length;
        out.push({
          type: 'group',
          id: `${reason}:${notification.event.id}:${total}`,
          reason,
          notifications: members,
          total,
          ...(notification.totalCapped ? { totalCapped: true } : {}),
        });
        index += 1;
        continue;
      }
    }

    const reason = batchableReason(notification.reason);
    // Single (server-marked or non-batchable reason) renders on its own.
    if (!reason || notification.type === 'single') {
      out.push({ type: 'single', id: notification.event.id, notification });
      index += 1;
      continue;
    }

    // Fallback: client-side consecutive-run grouping for the ungrouped (GraphQL)
    // transport, which doesn't carry server group metadata.
    const group = [notification];
    const batchKey = batchKeyFor(notification, reason);
    index += 1;
    while (index < notifications.length) {
      const next = notifications[index];
      if (
        !next ||
        next.type === 'group' ||
        next.reason !== reason ||
        batchKeyFor(next, reason) !== batchKey
      )
        break;
      group.push(next);
      index += 1;
    }

    if (group.length === 1) {
      out.push({ type: 'single', id: notification.event.id, notification });
      continue;
    }

    const first = group[0]!;
    const last = group[group.length - 1]!;
    out.push({
      type: 'group',
      id: `${reason}:${first.event.id}:${last.event.id}:${group.length}`,
      reason,
      notifications: group,
      total: group.length,
    });
  }

  return out;
}
