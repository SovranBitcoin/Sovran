import type React from 'react';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import type {
  ContentSegment,
  FeedEvent,
  FeedItem,
  NoteMetrics,
  ProfileInfo,
  VideoPostRecord,
} from './feedTypes';
import { DEFAULT_METRICS } from './feedTypes';
import type { ImageOverlayPost } from './image-overlay/types';
import { URL_REGEX, VIDEO_EXT, parseContent } from './feedParse';

export const MAX_VIDEO_FEED_PAGES = 20;

function getVideoUrlsFromContent(content: string): string[] {
  const urls: string[] = [];
  for (const m of content.matchAll(URL_REGEX)) {
    if (VIDEO_EXT.test(m[0])) {
      urls.push(m[0]);
    }
  }
  return urls;
}

export function buildDedupedVideoPosts(events: FeedEvent[]): VideoPostRecord[] {
  const result: VideoPostRecord[] = [];
  const seenUrls = new Set<string>();
  for (const event of events) {
    const videoUrls = getVideoUrlsFromContent(event.content);
    if (videoUrls.length === 0) continue;
    const url = videoUrls[0];
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);
    result.push({
      eventId: event.id,
      videoUrl: url,
      content: event.content,
      pubkey: event.pubkey,
      created_at: event.created_at,
    });
  }
  return result;
}

/**
 * Given an array of feed items and a profiles ref, build the
 * ImageOverlayReplaceLayout for a specific item by feed index.
 * Shared between HomeFeed and UserFeed.
 */
export function buildVideoOverlayLayout(
  feedIndex: number,
  feedItems: FeedItem[],
  getDisplayMetrics: (id: string) => NoteMetrics,
  getEngagementState: (id: string) => {
    liked: boolean;
    reposted: boolean;
    likePending: boolean;
    repostPending: boolean;
    likePendingDirection?: 'activating' | 'deactivating';
    repostPendingDirection?: 'activating' | 'deactivating';
  },
  profilesRef: React.RefObject<Map<string, ProfileInfo>>,
  toggleLike: (event: FeedEvent) => void,
  toggleRepost: (event: FeedEvent) => void
): {
  url: string;
  urls: string[];
  mediaTypes: ('image' | 'video')[];
  initialIndex: number;
  aspectRatio: number;
  post: ImageOverlayPost;
} | null {
  const item = feedItems[feedIndex];
  const candidates =
    item?.type === 'note'
      ? [item.rootEvent, item.event, ...(item.replyPreviewEvents ?? [])]
      : [item?.rootEvent, item?.originalEvent];
  const event = candidates.find(
    (candidate): candidate is FeedEvent =>
      !!candidate && getVideoUrlsFromContent(candidate.content).length > 0
  );
  if (!event) return null;
  const segments = parseContent(event.content);
  const blockSegments = segments.filter(
    (s): s is ContentSegment & { kind: 'image' | 'video'; url: string } =>
      s.kind === 'image' || s.kind === 'video'
  );
  if (blockSegments.length === 0) return null;
  const urls = blockSegments.map((s) => s.url);
  const mediaTypes = blockSegments.map((s) =>
    s.kind === 'video' ? ('video' as const) : ('image' as const)
  );
  const firstVideoIndex = mediaTypes.indexOf('video');
  if (firstVideoIndex === -1) return null;
  const metrics = getDisplayMetrics(event.id) || DEFAULT_METRICS;
  const engagement = getEngagementState(event.id);
  const profile = profilesRef.current?.get(event.pubkey) ?? null;
  return {
    url: urls[firstVideoIndex],
    urls,
    mediaTypes,
    initialIndex: firstVideoIndex,
    aspectRatio: 16 / 9,
    post: {
      event: {
        id: event.id,
        kind: event.kind,
        pubkey: event.pubkey,
        content: event.content,
        tags: event.tags,
        created_at: event.created_at,
      },
      metrics: {
        replyCount: metrics.replyCount,
        repostCount: metrics.repostCount,
        likeCount: metrics.likeCount,
        satsZapped: metrics.satsZapped,
      },
      profile: profile ?? undefined,
      reposted: engagement.reposted,
      liked: engagement.liked,
      repostPending: engagement.repostPending,
      likePending: engagement.likePending,
      repostPendingDirection: engagement.repostPendingDirection,
      likePendingDirection: engagement.likePendingDirection,
      onCommentPress: () =>
        router.navigate({
          pathname: '/(user-flow)/thread',
          params: { eventId: event.id },
        }),
      onRepostPress: () => toggleRepost(event),
      onLikePress: () => toggleLike(event),
    },
  };
}

/**
 * Build video feed indices — returns the list indices that contain video content.
 * Shared between HomeFeed and UserFeed.
 */
export function computeFeedIndicesWithVideo(feedItems: FeedItem[]): number[] {
  const out: number[] = [];
  feedItems.forEach((item, i) => {
    const events =
      item.type === 'note'
        ? [item.rootEvent, item.event, ...(item.replyPreviewEvents ?? [])]
        : [item.rootEvent, item.originalEvent];
    if (events.some((event) => event && getVideoUrlsFromContent(event.content).length > 0)) {
      out.push(i);
    }
  });
  return out;
}
