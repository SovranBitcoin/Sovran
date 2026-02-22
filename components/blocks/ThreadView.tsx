/**
 * @fileoverview Thread View Component
 *
 * Displays a Nostr post in detail with its reply chain (parents above,
 * replies below). Uses Primal's cache relay thread_view API.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { StyleSheet, ActivityIndicator, InteractionManager } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { ShortTextNote, Metadata } from 'nostr-tools/kinds';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list';
import { useHeaderHeight } from '@react-navigation/elements';

import {
  buildDedupedVideoPosts,
  type FeedEvent,
  type NoteMetrics,
  type ProfileInfo,
  DEFAULT_METRICS,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_NOTE_STATS,
  PRIMAL_KIND_MENTIONS,
  createPrimalRelayClient,
  collectReferencedIds,
  normalizeFeedEvent,
  parseJson,
  parseProfileFromRaw,
  parseNoteMetrics,
} from './nostr/shared';

import { PostCard } from './nostr/PostCard';

import { VideoFeedOverlay, type VideoPost } from './UserFeed';
import { ImageOverlayProvider, useImageOverlay } from './nostr/image-overlay-provider';
import { AnimatedImageOverlay } from './nostr/animated-image-overlay';
import { useNostrEngagement } from '@/hooks/useNostrEngagement';

// ============================================================================
// Types
// ============================================================================

interface ThreadViewProps {
  eventId: string;
}

type ThreadItem =
  | { type: 'parent'; event: FeedEvent }
  | { type: 'target'; event: FeedEvent }
  | { type: 'reply'; event: FeedEvent };

// ============================================================================
// Thread data fetching helpers
// ============================================================================

/**
 * Given the target eventId and all events from thread_view, build:
 * - parents: chain of ancestor posts above the target
 * - target: the focused event
 * - replies: direct replies to the target
 */
function buildThreadStructure(
  eventId: string,
  allEvents: Map<string, FeedEvent>
): { parents: FeedEvent[]; target: FeedEvent | null; replies: FeedEvent[] } {
  const target = allEvents.get(eventId) || null;
  if (!target) return { parents: [], target: null, replies: [] };

  // Build parent chain by walking e-tags upward
  const parents: FeedEvent[] = [];
  let current = target;
  const visited = new Set<string>([eventId]);

  while (true) {
    const eTags = (current.tags || []).filter((t) => t[0] === 'e');
    // Look for 'reply' marker first, then 'root', then fall back to last e-tag
    const replyTag = eTags.find((t) => t[3] === 'reply');
    const rootTag = eTags.find((t) => t[3] === 'root');
    const parentTag = replyTag || rootTag || (eTags.length > 0 ? eTags[eTags.length - 1] : null);

    if (!parentTag) break;
    const parentId = parentTag[1];
    if (visited.has(parentId)) break;
    visited.add(parentId);

    const parentEvent = allEvents.get(parentId);
    if (!parentEvent) break;

    parents.unshift(parentEvent);
    current = parentEvent;
  }

  // Find direct replies: Kind 1 events with an e-tag pointing to our eventId
  const replies: FeedEvent[] = [];
  for (const ev of allEvents.values()) {
    if (ev.id === eventId) continue;
    if (ev.kind !== ShortTextNote) continue;
    if (parents.some((p) => p.id === ev.id)) continue;

    const eTags = (ev.tags || []).filter((t) => t[0] === 'e');
    // Check if any e-tag with 'reply' marker points to our event
    const replyTag = eTags.find((t) => t[3] === 'reply');
    if (replyTag && replyTag[1] === eventId) {
      replies.push(ev);
      continue;
    }
    // Check if root tag points to our event and there's no reply marker
    // (NIP-10: if only root is present, it's a direct reply)
    if (!replyTag) {
      const rootTag = eTags.find((t) => t[3] === 'root');
      if (rootTag && rootTag[1] === eventId) {
        replies.push(ev);
        continue;
      }
    }
    // If no markers, check if the last e-tag points to our event (NIP-10 positional)
    if (!replyTag && eTags.length > 0) {
      const lastETag = eTags[eTags.length - 1];
      if (lastETag[1] === eventId && lastETag[3] !== 'root' && lastETag[3] !== 'mention') {
        replies.push(ev);
        continue;
      }
    }
  }

  replies.sort((a, b) => a.created_at - b.created_at);

  return { parents, target, replies };
}

// ============================================================================
// Main ThreadView Component
// ============================================================================

function ThreadViewInner({ eventId }: ThreadViewProps) {
  const { getPrimaryColor } = useTheme();
  const headerHeight = useHeaderHeight();
  const imageOverlay = useImageOverlay();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data state
  const [threadItems, setThreadItems] = useState<ThreadItem[]>([]);
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(new Map());
  const [metricsMap, setMetricsMap] = useState<Map<string, NoteMetrics>>(new Map());
  const [quotedEventsMap, setQuotedEventsMap] = useState<Map<string, FeedEvent>>(new Map());

  // Stable refs for renderItem — avoids re-creating renderItem on every Map update
  const profilesRef = useRef(profilesMap);
  profilesRef.current = profilesMap;
  const metricsRef = useRef(metricsMap);
  metricsRef.current = metricsMap;
  const quotedRef = useRef(quotedEventsMap);
  quotedRef.current = quotedEventsMap;
  const [dataVersion, setDataVersion] = useState(0);

  // Video feed overlay state
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [overlayStartIndex, setOverlayStartIndex] = useState(0);
  const [hiddenReplyCount, setHiddenReplyCount] = useState(0);

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Index of the target item to scroll to
  const targetIndex = useMemo(() => {
    return threadItems.findIndex((item) => item.type === 'target');
  }, [threadItems]);

  const getMetrics = useCallback(
    (id: string): NoteMetrics => metricsRef.current.get(id) || DEFAULT_METRICS,
    []
  );

  const actionableEvents = useMemo(() => threadItems.map((item) => item.event), [threadItems]);
  const actionableEventsById = useMemo(() => {
    const map = new Map<string, FeedEvent>();
    for (const event of actionableEvents) map.set(event.id, event);
    return map;
  }, [actionableEvents]);

  const { getDisplayMetrics, getEngagementState, toggleLike, toggleRepost, engagementRevision } =
    useNostrEngagement(actionableEvents, getMetrics);

  // Build video posts list from thread items
  const videoPosts = useMemo((): VideoPost[] => {
    const sourceEvents: FeedEvent[] = [];
    for (const item of threadItems) {
      const event = item.event;
      sourceEvents.push(event);
    }
    return buildDedupedVideoPosts(sourceEvents);
  }, [threadItems]);

  const videoIndexByUrl = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < videoPosts.length; i++) {
      map.set(videoPosts[i].videoUrl, i);
    }
    return map;
  }, [videoPosts]);

  const handleVideoTap = useCallback(
    (tappedUrl: string) => {
      const index = videoIndexByUrl.get(tappedUrl);
      if (index == null) return;
      setOverlayStartIndex(index);
      setOverlayVisible(true);
    },
    [videoIndexByUrl]
  );

  // Fetch thread data
  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const fetchThread = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);

      try {
        const prefix = Date.now().toString(36);

        // Phase 1: thread_view
        const rawEvents = await client.request(`${prefix}_thread`, {
          cache: [
            'thread_view',
            {
              event_id: eventId,
              limit: 200,
            },
          ],
        });

        if (cancelled) return;

        // Parse raw events
        const allEvents = new Map<string, FeedEvent>();
        const profiles = new Map<string, ProfileInfo>();
        const metrics = new Map<string, NoteMetrics>();
        const embeddedMentions = new Map<string, FeedEvent>();

        for (const raw of rawEvents) {
          if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
            const parsed = parseJson<Record<string, unknown>>(raw.content);
            const eid = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
            if (!eid || !parsed) continue;
            metrics.set(eid, parseNoteMetrics(parsed));
            continue;
          }

          if (raw.kind === PRIMAL_KIND_MENTIONS) {
            const mentionEvent = normalizeFeedEvent(parseJson<unknown>(raw.content));
            if (!mentionEvent) continue;
            embeddedMentions.set(mentionEvent.id, mentionEvent);
            allEvents.set(mentionEvent.id, mentionEvent);
            continue;
          }

          if (raw.kind === Metadata) {
            const result = parseProfileFromRaw(raw);
            if (result) profiles.set(result[0], result[1]);
            continue;
          }

          const ev = normalizeFeedEvent(raw);
          if (!ev) continue;
          if (ev.kind === ShortTextNote) {
            allEvents.set(ev.id, ev);
          }
        }

        if (cancelled) return;

        // Build thread structure
        let { parents, target, replies } = buildThreadStructure(eventId, allEvents);

        if (!target) {
          if (mountedRef.current) {
            setError('Post not found');
            setIsLoading(false);
          }
          return;
        }

        // Supplementary reply fetch: if metrics indicate more replies exist than
        // thread_view returned, try a dedicated reply endpoint for additional coverage
        const suppExpected = metrics.get(eventId)?.replyCount ?? 0;
        if (suppExpected > replies.length && !cancelled) {
          try {
            const suppRaw = await client.request(`${prefix}_supp`, {
              cache: ['event_replies', { event_id: eventId, limit: 50 }],
            });
            let foundNew = false;
            for (const raw of suppRaw) {
              if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
                const parsed = parseJson<Record<string, unknown>>(raw.content);
                const eid = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
                if (!eid || !parsed) continue;
                metrics.set(eid, parseNoteMetrics(parsed));
                continue;
              }
              if (raw.kind === PRIMAL_KIND_MENTIONS) {
                const mentionEvent = normalizeFeedEvent(parseJson<unknown>(raw.content));
                if (mentionEvent) {
                  embeddedMentions.set(mentionEvent.id, mentionEvent);
                  allEvents.set(mentionEvent.id, mentionEvent);
                }
                continue;
              }
              if (raw.kind === Metadata) {
                const result = parseProfileFromRaw(raw);
                if (result) profiles.set(result[0], result[1]);
                continue;
              }
              const ev = normalizeFeedEvent(raw);
              if (ev && ev.kind === ShortTextNote && !allEvents.has(ev.id)) {
                allEvents.set(ev.id, ev);
                foundNew = true;
              }
            }
            if (foundNew && !cancelled) {
              const rebuilt = buildThreadStructure(eventId, allEvents);
              if (rebuilt.target) {
                parents = rebuilt.parents;
                target = rebuilt.target;
                replies = rebuilt.replies;
              }
            }
          } catch {
            // event_replies not available on this Primal cache version
          }
        }

        // Phase 2: Fetch missing quoted events
        const contentSources = [target, ...parents, ...replies];
        const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
          collectReferencedIds(contentSources);
        const quotedEvents = new Map<string, FeedEvent>(embeddedMentions);
        const missingQuotedIds = referencedEventIds.filter((id) => !quotedEvents.has(id));

        if (missingQuotedIds.length > 0) {
          const quotedRawEvents = await client.request(`${prefix}_quoted`, {
            cache: ['events', { event_ids: missingQuotedIds }],
          });
          if (!cancelled) {
            for (const raw of quotedRawEvents) {
              if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
                const parsed = parseJson<Record<string, unknown>>(raw.content);
                const eid = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
                if (!eid || !parsed) continue;
                metrics.set(eid, parseNoteMetrics(parsed));
                continue;
              }
              const ev = normalizeFeedEvent(raw);
              if (ev) quotedEvents.set(ev.id, ev);
              if (raw.kind === Metadata) {
                const result = parseProfileFromRaw(raw);
                if (result) profiles.set(result[0], result[1]);
              }
            }
          }
        }

        // Phase 3: Fetch missing profiles
        const neededPubkeys = new Set(inlineMentionPubkeys);
        for (const ev of contentSources) neededPubkeys.add(ev.pubkey);
        for (const ev of quotedEvents.values()) neededPubkeys.add(ev.pubkey);
        const missingProfilePubkeys = Array.from(neededPubkeys).filter((pk) => !profiles.has(pk));

        if (missingProfilePubkeys.length > 0) {
          const profileRawEvents = await client.request(`${prefix}_profiles`, {
            cache: ['user_infos', { pubkeys: missingProfilePubkeys }],
          });
          if (!cancelled) {
            for (const raw of profileRawEvents) {
              if (raw.kind === Metadata) {
                const result = parseProfileFromRaw(raw);
                if (result) profiles.set(result[0], result[1]);
              }
            }
          }
        }

        if (cancelled) return;

        // Build thread items list
        const items: ThreadItem[] = [];

        for (let i = 0; i < parents.length; i++) {
          items.push({ type: 'parent', event: parents[i] });
        }

        items.push({ type: 'target', event: target });

        for (const reply of replies) {
          items.push({ type: 'reply', event: reply });
        }

        if (mountedRef.current) {
          // Compute hidden reply count from metrics vs loaded replies
          const targetMetrics = metrics.get(eventId);
          const expectedReplies = targetMetrics?.replyCount ?? 0;
          const hidden = Math.max(0, expectedReplies - replies.length);
          setHiddenReplyCount(hidden);

          setThreadItems(items);
          setProfilesMap(profiles);
          setMetricsMap(metrics);
          setQuotedEventsMap(quotedEvents);
          setDataVersion((v) => v + 1);
          setIsLoading(false);
        }
      } catch {
        if (mountedRef.current && !cancelled) {
          setError('Failed to load thread');
          setIsLoading(false);
        }
      } finally {
        client.close();
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      fetchThread();
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [eventId]);

  const keyExtractor = useCallback((item: ThreadItem) => {
    switch (item.type) {
      case 'parent':
        return `p_${item.event.id}`;
      case 'target':
        return `t_${item.event.id}`;
      case 'reply':
        return `r_${item.event.id}`;
    }
  }, []);

  const hasParents = useMemo(() => threadItems.some((i) => i.type === 'parent'), [threadItems]);

  const renderItem = useCallback(
    ({ item, index }: LegendListRenderItemProps<ThreadItem, string | undefined>) => {
      const isParent = item.type === 'parent';
      const isTarget = item.type === 'target';

      const showLineAbove = isParent ? index > 0 : isTarget ? hasParents : false;
      const showLineBelow = isParent ? true : false;

      const metrics = getDisplayMetrics(item.event.id);
      const engagement = getEngagementState(item.event.id);

      return (
        <PostCard
          variant={isTarget ? 'thread-target' : 'thread-reply'}
          event={item.event}
          metrics={metrics}
          quotedEvents={quotedRef.current}
          profiles={profilesRef.current}
          getMetrics={getMetrics}
          showLineAbove={showLineAbove}
          showLineBelow={showLineBelow}
          onVideoTap={handleVideoTap}
          liked={engagement.liked}
          reposted={engagement.reposted}
          likePending={engagement.likePending}
          repostPending={engagement.repostPending}
          likePendingDirection={engagement.likePendingDirection}
          repostPendingDirection={engagement.repostPendingDirection}
          onLikePress={() => toggleLike(item.event)}
          onRepostPress={() => toggleRepost(item.event)}
        />
      );
    },
    [
      getDisplayMetrics,
      getEngagementState,
      getMetrics,
      hasParents,
      handleVideoTap,
      toggleLike,
      toggleRepost,
    ]
  );

  if (isLoading) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          { backgroundColor: getPrimaryColor('950'), paddingTop: headerHeight },
        ]}>
        <ActivityIndicator size="small" color={getPrimaryColor('400')} />
      </View>
    );
  }

  if (error) {
    return (
      <View
        style={[
          styles.container,
          styles.centerContent,
          { backgroundColor: getPrimaryColor('950'), paddingTop: headerHeight },
        ]}>
        <Icon name="mdi:message-text" size={40} color={getPrimaryColor('600')} />
        <Spacer size={12} />
        <Text size={15} style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
          {error}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: getPrimaryColor('950') }]}>
      <LegendList
        data={threadItems}
        keyExtractor={keyExtractor}
        getItemType={(item) => item.type}
        estimatedItemSize={200}
        drawDistance={500}
        renderItem={renderItem}
        extraData={`${dataVersion}:${engagementRevision}`}
        recycleItems
        ListFooterComponent={
          hiddenReplyCount > 0 ? (
            <View style={styles.hiddenReplyFooter}>
              <Text size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4) }}>
                {hiddenReplyCount} more {hiddenReplyCount === 1 ? 'reply' : 'replies'} not loaded
              </Text>
            </View>
          ) : null
        }
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
        onScroll={
          imageOverlay?.scrollOffsetY != null
            ? (e: { nativeEvent: { contentOffset: { y: number } } }) => {
                imageOverlay.scrollOffsetY.value = e.nativeEvent.contentOffset.y;
              }
            : undefined
        }
        scrollEventThrottle={16}
        initialScrollIndex={targetIndex > 0 ? targetIndex : undefined}
      />
      <AnimatedImageOverlay />
      {overlayVisible && (
        <VideoFeedOverlay
          videoPosts={videoPosts}
          profilesMap={profilesMap}
          metricsMap={metricsMap}
          startIndex={overlayStartIndex}
          onClose={() => setOverlayVisible(false)}
          getDisplayMetrics={getDisplayMetrics}
          getEngagementState={getEngagementState}
          engagementRevision={engagementRevision}
          onLikePress={(eventId) => {
            const event = actionableEventsById.get(eventId);
            if (event) toggleLike(event);
          }}
          onRepostPress={(eventId) => {
            const event = actionableEventsById.get(eventId);
            if (event) toggleRepost(event);
          }}
        />
      )}
    </View>
  );
}

function ThreadViewComponent(props: ThreadViewProps) {
  return (
    <ImageOverlayProvider>
      <ThreadViewInner {...props} />
    </ImageOverlayProvider>
  );
}

export const ThreadView = React.memo(ThreadViewComponent);

// ============================================================================
// Styles (ThreadView-specific only — shared styles live in nostr/shared.tsx)
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hiddenReplyFooter: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
});
