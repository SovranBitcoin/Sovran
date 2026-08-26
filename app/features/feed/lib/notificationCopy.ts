import type {
  FeedNotificationPolicy,
  FeedNotificationReplyScope,
} from '@/features/feed/data/feedClient';

export function notificationReasonLabel(reason: string): string {
  switch (reason) {
    case 'follow':
      return 'followed you';
    case 'reaction':
      return 'reacted';
    case 'repost':
      return 'reposted';
    case 'zap':
      return 'zapped';
    case 'reply':
      return 'replied';
    case 'quote':
      return 'quoted you';
    case 'mention':
      return 'mentioned you';
    default:
      return reason;
  }
}

export function notificationPolicyLabel(policy: FeedNotificationPolicy): string {
  switch (policy) {
    case 'RELAXED':
      return 'Relaxed';
    case 'MODERATE':
      return 'Moderate';
    case 'STRICT':
      return 'Strict';
    case 'FOLLOWS':
      return 'Follows';
  }
}

export function notificationReplyScopeLabel(scope: FeedNotificationReplyScope): string {
  switch (scope) {
    case 'DIRECT':
      return 'Direct replies';
    case 'THREAD':
      return 'Thread replies';
  }
}
