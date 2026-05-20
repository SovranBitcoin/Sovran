import { useEffect, useRef, useState } from 'react';
import { InteractionManager, useWindowDimensions } from 'react-native';
import { Metadata, ShortTextNote } from 'nostr-tools/kinds';

import {
  collectReferencedIds,
  normalizeFeedEvent,
  parseJson,
  parseNoteMetrics,
  parseProfileFromRaw,
} from '@/features/feed/components/nostr/feedParse';
import {
  createPrimalRelayClient,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_MENTIONS,
  PRIMAL_KIND_NOTE_STATS,
} from '@/features/feed/components/nostr/primalRelay';
import type {
  FeedEvent,
  NoteMetrics,
  ProfileInfo,
  RawPrimalEvent,
} from '@/features/feed/components/nostr/feedTypes';
import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import { consumeThreadSeed } from '@/features/feed/lib/threadSeedCache';
import {
  charsPerLineForWidth,
  DEFAULT_REPLY_SKELETON_COUNT,
  MAX_REPLY_SKELETON_COUNT,
  type ReplySkeletonMatch,
  sortRepliesForSkeletons,
} from '@/features/feed/lib/threadReplySkeletons';
import { feedLog } from '@/shared/lib/logger';

export type ThreadItem =
  | { type: 'parent'; event: FeedEvent }
  | { type: 'target'; event: FeedEvent }
  | { type: 'reply'; event: FeedEvent; skeletonMatch?: ReplySkeletonMatch };

let threadRequestCounter = 0;

function nextRequestPrefix(): string {
  threadRequestCounter = (threadRequestCounter + 1) >>> 0;
  return `${Date.now().toString(36)}_${threadRequestCounter.toString(36)}`;
}

type MergeBuckets = {
  allEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  metrics: Map<string, NoteMetrics>;
  embeddedMentions: Map<string, FeedEvent>;
};

type MergeOptions = {
  /** When true, only set events not already present in `allEvents`. */
  skipExistingEvents?: boolean;
  /** When true, route quoted events into the quoted-events map regardless of kind. */
  includeAsQuoted?: Map<string, FeedEvent>;
};

function mergeRawEvents(
  rawEvents: RawPrimalEvent[],
  buckets: MergeBuckets,
  opts: MergeOptions = {}
): { foundNewNote: boolean } {
  let foundNewNote = false;
  for (const raw of rawEvents) {
    if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      const eid = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
      if (eid && parsed) buckets.metrics.set(eid, parseNoteMetrics(parsed));
      continue;
    }
    if (raw.kind === PRIMAL_KIND_MENTIONS) {
      const mentionEvent = normalizeFeedEvent(parseJson<unknown>(raw.content));
      if (!mentionEvent) continue;
      buckets.embeddedMentions.set(mentionEvent.id, mentionEvent);
      buckets.allEvents.set(mentionEvent.id, mentionEvent);
      continue;
    }
    if (raw.kind === Metadata) {
      const result = parseProfileFromRaw(raw);
      if (result) buckets.profiles.set(result[0], result[1]);
      continue;
    }
    const ev = normalizeFeedEvent(raw);
    if (!ev) continue;
    if (opts.includeAsQuoted) {
      opts.includeAsQuoted.set(ev.id, ev);
      continue;
    }
    if (ev.kind !== ShortTextNote) continue;
    if (opts.skipExistingEvents && buckets.allEvents.has(ev.id)) continue;
    buckets.allEvents.set(ev.id, ev);
    foundNewNote = true;
  }
  return { foundNewNote };
}

type UseThreadResult = {
  items: ThreadItem[];
  hiddenReplyCount: number;
  isLoading: boolean;
  isFetching: boolean;
  error: string | null;
  dataVersion: number;
  profilesRef: React.MutableRefObject<Map<string, ProfileInfo>>;
  metricsRef: React.MutableRefObject<Map<string, NoteMetrics>>;
  quotedEventsRef: React.MutableRefObject<Map<string, FeedEvent>>;
};

const EMPTY_PROFILES: Map<string, ProfileInfo> = new Map();
const EMPTY_METRICS: Map<string, NoteMetrics> = new Map();
const EMPTY_QUOTED: Map<string, FeedEvent> = new Map();

export function useThread(eventId: string): UseThreadResult {
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [hiddenReplyCount, setHiddenReplyCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const profilesRef = useRef<Map<string, ProfileInfo>>(EMPTY_PROFILES);
  const metricsRef = useRef<Map<string, NoteMetrics>>(EMPTY_METRICS);
  const quotedEventsRef = useRef<Map<string, FeedEvent>>(EMPTY_QUOTED);

  const { width: viewportWidth } = useWindowDimensions();
  const charsPerLineRef = useRef(charsPerLineForWidth(viewportWidth));
  charsPerLineRef.current = charsPerLineForWidth(viewportWidth);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
    setError(null);
    setIsFetching(true);

    const seed = consumeThreadSeed(eventId);
    if (seed) {
      const seeded = buildThreadStructure(eventId, seed.allEvents);
      if (seeded.target) {
        const seededItems: ThreadItem[] = [
          ...seeded.parents.map<ThreadItem>((event) => ({ type: 'parent', event })),
          { type: 'target', event: seeded.target },
        ];
        profilesRef.current = seed.profiles;
        metricsRef.current = seed.metrics;
        quotedEventsRef.current = seed.quotedEvents;
        setItems(seededItems);
        setHiddenReplyCount(0);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }
    } else {
      setItems([]);
      setHiddenReplyCount(0);
      setIsLoading(true);
    }

    feedLog.info('thread.load.start', { eventId, seeded: !!seed });

    const fetchThread = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);

      try {
        const prefix = nextRequestPrefix();

        const buckets: MergeBuckets = {
          allEvents: seed ? new Map(seed.allEvents) : new Map<string, FeedEvent>(),
          profiles: seed ? new Map(seed.profiles) : new Map<string, ProfileInfo>(),
          metrics: seed ? new Map(seed.metrics) : new Map<string, NoteMetrics>(),
          embeddedMentions: seed ? new Map(seed.quotedEvents) : new Map<string, FeedEvent>(),
        };

        const phase1Raw = await client.request(`${prefix}_thread`, {
          cache: ['thread_view', { event_id: eventId, limit: 200 }],
        });
        if (cancelled) return;
        mergeRawEvents(phase1Raw, buckets);

        const initial = buildThreadStructure(eventId, buckets.allEvents);
        if (!initial.target) {
          setError('Post not found');
          setIsLoading(false);
          setIsFetching(false);
          return;
        }

        const suppExpected = buckets.metrics.get(eventId)?.replyCount ?? 0;
        const shouldFetchSupplementary =
          initial.replies.length === 0 || suppExpected > initial.replies.length;
        let thread = initial;
        if (shouldFetchSupplementary && !cancelled) {
          try {
            const suppRaw = await client.request(`${prefix}_supp`, {
              cache: ['event_replies', { event_id: eventId, limit: 50 }],
            });
            if (!cancelled) {
              const { foundNewNote } = mergeRawEvents(suppRaw, buckets, {
                skipExistingEvents: true,
              });
              if (foundNewNote) {
                const rebuilt = buildThreadStructure(eventId, buckets.allEvents);
                if (rebuilt.target) thread = rebuilt;
              }
            }
          } catch (err) {
            feedLog.warn('thread.supp_fetch_failed', {
              eventId,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        }

        if (cancelled) return;

        const contentSources = [thread.target!, ...thread.parents, ...thread.replies];
        const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
          collectReferencedIds(contentSources);
        const quotedEvents = new Map<string, FeedEvent>(buckets.embeddedMentions);
        const missingQuotedIds = referencedEventIds.filter((id) => !quotedEvents.has(id));

        if (missingQuotedIds.length > 0) {
          const quotedRaw = await client.request(`${prefix}_quoted`, {
            cache: ['events', { event_ids: missingQuotedIds }],
          });
          if (!cancelled) {
            mergeRawEvents(quotedRaw, buckets, { includeAsQuoted: quotedEvents });
          }
        }

        const neededPubkeys = new Set(inlineMentionPubkeys);
        for (const ev of contentSources) neededPubkeys.add(ev.pubkey);
        for (const ev of quotedEvents.values()) neededPubkeys.add(ev.pubkey);
        const missingProfilePubkeys = Array.from(neededPubkeys).filter(
          (pk) => !buckets.profiles.has(pk)
        );

        if (missingProfilePubkeys.length > 0) {
          const profileRaw = await client.request(`${prefix}_profiles`, {
            cache: ['user_infos', { pubkeys: missingProfilePubkeys }],
          });
          if (!cancelled) mergeRawEvents(profileRaw, buckets);
        }

        if (cancelled) return;

        const target = thread.target!;
        const targetMetrics = buckets.metrics.get(eventId);
        const expectedReplies = targetMetrics?.replyCount ?? 0;
        const skeletonMatchCount = Math.min(
          MAX_REPLY_SKELETON_COUNT,
          targetMetrics?.replyCount ?? DEFAULT_REPLY_SKELETON_COUNT
        );
        const sortedReplies = sortRepliesForSkeletons(
          thread.replies,
          skeletonMatchCount,
          charsPerLineRef.current
        );
        const replies = sortedReplies.replies;
        const nextItems: ThreadItem[] = [
          ...thread.parents.map<ThreadItem>((event) => ({ type: 'parent', event })),
          { type: 'target', event: target },
          ...replies.map<ThreadItem>((event, index) => ({
            type: 'reply',
            event,
            skeletonMatch: sortedReplies.matches[index],
          })),
        ];

        const hidden = Math.max(0, expectedReplies - replies.length);

        feedLog.info('thread.load.done', {
          eventId,
          parents: thread.parents.length,
          replies: thread.replies.length,
          profiles: buckets.profiles.size,
          hiddenReplies: hidden,
        });

        feedLog.info('thread.reply_skeleton.sort', {
          eventId,
          expectedReplies,
          receivedReplies: thread.replies.length,
          skeletonMatchCount,
          originalOrder: thread.replies.slice(0, 10).map((event, originalIndex) => ({
            originalIndex,
            eventId: event.id,
            contentLength: event.content.length,
          })),
          sortedOrder: sortedReplies.matches.slice(0, 10),
          visibleMatches: sortedReplies.matches.filter((match) => match.skeletonIndex !== null),
        });

        profilesRef.current = buckets.profiles;
        metricsRef.current = buckets.metrics;
        quotedEventsRef.current = quotedEvents;

        setItems(nextItems);
        setHiddenReplyCount(hidden);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
        setIsFetching(false);
      } catch (err) {
        if (!cancelled) {
          feedLog.error('thread.load.error', {
            eventId,
            error: err instanceof Error ? err : new Error(String(err)),
          });
          if (!seed) {
            setError('Failed to load thread');
            setIsLoading(false);
          }
          setIsFetching(false);
        }
      } finally {
        client.close();
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      void fetchThread();
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [eventId]);

  return {
    items,
    hiddenReplyCount,
    isLoading,
    isFetching,
    error,
    dataVersion,
    profilesRef,
    metricsRef,
    quotedEventsRef,
  };
}
