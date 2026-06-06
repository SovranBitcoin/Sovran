import type { FeedEvent, FeedItem } from '@/features/feed/components/nostr/feedTypes';

export function getFeedItemRootContext(item: FeedItem): FeedEvent | undefined {
  const rootEvent = item.rootEvent;
  if (!rootEvent) return undefined;

  const visibleEventId = item.type === 'note' ? item.event.id : item.originalEvent?.id;
  if (!visibleEventId || rootEvent.id === visibleEventId) return undefined;

  return rootEvent;
}
