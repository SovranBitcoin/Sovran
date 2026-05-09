import { useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { Metadata, ShortTextNote } from 'nostr-tools/kinds';

import {
  collectReferencedIds,
  createPrimalRelayClient,
  normalizeFeedEvent,
  parseJson,
  parseNoteMetrics,
  parseProfileFromRaw,
  PRIMAL_CACHE_RELAY_URL,
  PRIMAL_KIND_MENTIONS,
  PRIMAL_KIND_NOTE_STATS,
  type FeedEvent,
  type NoteMetrics,
  type ProfileInfo,
  type RawPrimalEvent,
} from '@/features/feed/components/nostr/shared';
import { buildThreadStructure } from '@/features/feed/lib/buildThreadStructure';
import { feedLog } from '@/shared/lib/logger';

export type ThreadItem =
  | { type: 'parent'; event: FeedEvent }
  | { type: 'target'; event: FeedEvent }
  | { type: 'reply'; event: FeedEvent };

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
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const profilesRef = useRef<Map<string, ProfileInfo>>(EMPTY_PROFILES);
  const metricsRef = useRef<Map<string, NoteMetrics>>(EMPTY_METRICS);
  const quotedEventsRef = useRef<Map<string, FeedEvent>>(EMPTY_QUOTED);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    feedLog.info('thread.load.start', { eventId });

    const fetchThread = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);

      try {
        const prefix = nextRequestPrefix();

        const buckets: MergeBuckets = {
          allEvents: new Map<string, FeedEvent>(),
          profiles: new Map<string, ProfileInfo>(),
          metrics: new Map<string, NoteMetrics>(),
          embeddedMentions: new Map<string, FeedEvent>(),
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
        const nextItems: ThreadItem[] = [
          ...thread.parents.map<ThreadItem>((event) => ({ type: 'parent', event })),
          { type: 'target', event: target },
          ...thread.replies.map<ThreadItem>((event) => ({ type: 'reply', event })),
        ];

        const targetMetrics = buckets.metrics.get(eventId);
        const expectedReplies = targetMetrics?.replyCount ?? 0;
        const hidden = Math.max(0, expectedReplies - thread.replies.length);

        feedLog.info('thread.load.done', {
          eventId,
          parents: thread.parents.length,
          replies: thread.replies.length,
          profiles: buckets.profiles.size,
          hiddenReplies: hidden,
        });

        profilesRef.current = buckets.profiles;
        metricsRef.current = buckets.metrics;
        quotedEventsRef.current = quotedEvents;

        setItems(nextItems);
        setHiddenReplyCount(hidden);
        setDataVersion((v) => v + 1);
        setIsLoading(false);
      } catch (err) {
        if (!cancelled) {
          feedLog.error('thread.load.error', {
            eventId,
            error: err instanceof Error ? err : new Error(String(err)),
          });
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

  return {
    items,
    hiddenReplyCount,
    isLoading,
    error,
    dataVersion,
    profilesRef,
    metricsRef,
    quotedEventsRef,
  };
}
