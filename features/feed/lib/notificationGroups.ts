import type { FeedNotification } from '@/features/feed/data/feedClient';

type BatchableNotificationReason = 'follow' | 'repost';

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
      notifications: FeedNotification[];
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
  if (reason === 'follow' || reason === 'repost') return reason;
  return null;
}

function batchKeyFor(notification: FeedNotification, reason: BatchableNotificationReason): string {
  if (reason === 'follow') return 'follow';
  return notification.targetEventId ?? notification.targetEvent?.id ?? notification.event.id;
}

export function buildNotificationListItems(
  notifications: readonly FeedNotification[]
): NotificationListItem[] {
  const out: NotificationListItem[] = [];
  let index = 0;

  while (index < notifications.length) {
    const notification = notifications[index];
    if (!notification) break;
    const reason = batchableReason(notification.reason);

    if (!reason) {
      out.push({
        type: 'single',
        id: notification.event.id,
        notification,
      });
      index += 1;
      continue;
    }

    const group = [notification];
    const batchKey = batchKeyFor(notification, reason);
    index += 1;
    while (index < notifications.length) {
      const next = notifications[index];
      if (!next || next.reason !== reason || batchKeyFor(next, reason) !== batchKey) break;
      group.push(next);
      index += 1;
    }

    if (group.length === 1) {
      out.push({
        type: 'single',
        id: notification.event.id,
        notification,
      });
      continue;
    }

    const first = group[0]!;
    const last = group[group.length - 1]!;
    out.push({
      type: 'group',
      id: `${reason}:${first.event.id}:${last.event.id}:${group.length}`,
      reason,
      notifications: group,
    });
  }

  return out;
}
