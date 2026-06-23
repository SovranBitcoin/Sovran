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
  // Open client-side groups keyed by reason+target, so members that aren't
  // adjacent in the (chronological) stream still merge into one row instead of
  // each landing on its own. A group is anchored at its first member's position.
  const clientGroups = new Map<string, Extract<NotificationListItem, { type: 'group' }>>();

  for (const notification of notifications) {
    if (!notification) continue;

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
        continue;
      }
    }

    const reason = batchableReason(notification.reason);
    // Single (server-marked or non-batchable reason, e.g. reply/mention) renders
    // on its own.
    if (!reason || notification.type === 'single') {
      out.push({ type: 'single', id: notification.event.id, notification });
      continue;
    }

    // Fallback: client-side grouping for ungrouped transports (raw relays /
    // GraphQL) that don't carry server group metadata. Group across the WHOLE
    // page by reason+target — not just consecutive runs — then demote any
    // single-member group back to a row below.
    const key = `${reason}:${batchKeyFor(notification, reason)}`;
    const open = clientGroups.get(key);
    if (open) {
      open.notifications.push(notification);
      open.total = open.notifications.length;
      continue;
    }
    const group: Extract<NotificationListItem, { type: 'group' }> = {
      type: 'group',
      id: `client:${key}`,
      reason,
      notifications: [notification],
      total: 1,
    };
    clientGroups.set(key, group);
    out.push(group);
  }

  // A client group that attracted no other members is really a single.
  return out.map((item) =>
    item.type === 'group' && item.id.startsWith('client:') && item.notifications.length === 1
      ? {
          type: 'single',
          id: item.notifications[0]!.event.id,
          notification: item.notifications[0]!,
        }
      : item
  );
}
