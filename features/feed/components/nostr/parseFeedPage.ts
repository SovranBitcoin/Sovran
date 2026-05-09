import { Metadata, ShortTextNote, Repost, GenericRepost } from 'nostr-tools/kinds';
import { log } from '@/shared/lib/logger';
import type { FeedEvent, FeedItem, NoteMetrics, ProfileInfo, RawPrimalEvent } from './feedTypes';
import { DEFAULT_METRICS } from './feedTypes';
import {
  collectReferencedIds,
  getFirstTagValue,
  normalizeFeedEvent,
  parseJson,
  parseNoteMetrics,
  parseProfileFromRaw,
} from './feedParse';
import { getEmbeddedRepostEvent } from './videoLayout';
import {
  PRIMAL_KIND_FEED_RANGE,
  PRIMAL_KIND_MENTIONS,
  PRIMAL_KIND_NOTE_STATS,
  type createPrimalRelayClient,
} from './primalRelay';

interface FeedParseResult {
  orderedFeedItems: FeedItem[];
  metricsMap: Map<string, NoteMetrics>;
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
  paginationUntil: number;
  paginationOffset: number;
}

/**
 * Options for {@link parseFeedPage}. Both predicates default to "include all".
 */
interface ParseFeedPageOptions {
  /** When provided, only text notes for which this returns true are included. */
  includeNote?: (event: FeedEvent) => boolean;
  /** When provided, only reposts for which this returns true are included. */
  includeRepost?: (event: FeedEvent) => boolean;
  /** Optional profile to seed into the result (e.g. the screen's known author). */
  extraProfile?: { pubkey: string; profile: ProfileInfo };
  /** When set, parse duration is reported under this event prefix. */
  perfLogTag?: string;
}

/**
 * Parse a Primal mega_feed_directive response into the shape both feed
 * components consume. Single canonical pass over the raw events:
 *
 *   1. Classify by kind (NOTE_STATS / FEED_RANGE / MENTIONS / Metadata / event)
 *   2. Optionally filter notes and reposts via the supplied predicates
 *   3. Build ordered FeedItems honouring FEED_RANGE if present, else timestamp
 *   4. Collect the referenced ids/pubkeys still missing from the page
 *
 * Both HomeFeed and UserFeed call this — see callers for predicate examples.
 */
export function parseFeedPage(
  feedRawEvents: RawPrimalEvent[],
  options: ParseFeedPageOptions = {}
): FeedParseResult {
  const { includeNote, includeRepost, extraProfile, perfLogTag } = options;
  const t0 = perfLogTag ? performance.now() : 0;

  const eventMap = new Map<string, FeedEvent>();
  const notes: FeedEvent[] = [];
  const reposts: FeedEvent[] = [];
  const embeddedMentionEvents = new Map<string, FeedEvent>();
  const metricsMap = new Map<string, NoteMetrics>();
  const profilesMap = new Map<string, ProfileInfo>();
  let feedOrder: string[] = [];
  let paginationUntil = 0;

  for (const raw of feedRawEvents) {
    if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      const eventId = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
      if (!eventId || !parsed) continue;
      metricsMap.set(eventId, parseNoteMetrics(parsed));
      continue;
    }

    if (raw.kind === PRIMAL_KIND_FEED_RANGE) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      if (Array.isArray(parsed?.elements)) {
        feedOrder = parsed.elements
          .map((el: unknown) => {
            if (typeof el === 'string') return el;
            if (
              el &&
              typeof el === 'object' &&
              'id' in el &&
              typeof (el as Record<string, unknown>).id === 'string'
            )
              return (el as Record<string, unknown>).id as string;
            return null;
          })
          .filter((id): id is string => id !== null);
      }
      const rawUntil = parsed?.until;
      if (typeof rawUntil === 'number' && rawUntil > 0) {
        paginationUntil = rawUntil;
      } else if (typeof rawUntil === 'string') {
        const num = Number(rawUntil);
        if (num > 0) paginationUntil = num;
      }
      continue;
    }

    if (raw.kind === PRIMAL_KIND_MENTIONS) {
      const mentionEvent = normalizeFeedEvent(parseJson<unknown>(raw.content));
      if (!mentionEvent) continue;
      embeddedMentionEvents.set(mentionEvent.id, mentionEvent);
      eventMap.set(mentionEvent.id, mentionEvent);
      continue;
    }

    const ev = normalizeFeedEvent(raw);
    if (!ev) continue;

    if (ev.kind === ShortTextNote) {
      eventMap.set(ev.id, ev);
      if (!includeNote || includeNote(ev)) notes.push(ev);
      continue;
    }

    if (ev.kind === Repost || ev.kind === GenericRepost) {
      eventMap.set(ev.id, ev);
      if (!includeRepost || includeRepost(ev)) reposts.push(ev);
      continue;
    }

    if (ev.kind === Metadata) {
      const result = parseProfileFromRaw(raw);
      if (result) profilesMap.set(result[0], result[1]);
      continue;
    }
  }

  if (extraProfile) {
    profilesMap.set(extraProfile.pubkey, extraProfile.profile);
  }

  const nextFeedItems: FeedItem[] = [];
  const feedItemsByEventId = new Map<string, FeedItem>();

  for (const note of notes) {
    const item: FeedItem = { type: 'note', event: note, timestamp: note.created_at || 0 };
    nextFeedItems.push(item);
    feedItemsByEventId.set(note.id, item);
  }

  for (const repostEvent of reposts) {
    const originalEventId = getFirstTagValue(repostEvent, 'e');
    if (!originalEventId) continue;
    let originalEvent = eventMap.get(originalEventId);
    if (!originalEvent) {
      originalEvent = getEmbeddedRepostEvent(repostEvent, originalEventId);
      if (originalEvent) eventMap.set(originalEvent.id, originalEvent);
    }

    const item: FeedItem = {
      type: 'repost',
      repostEvent,
      originalEvent,
      originalEventId,
      timestamp: repostEvent.created_at || 0,
    };
    nextFeedItems.push(item);
    feedItemsByEventId.set(repostEvent.id, item);
  }

  const orderedFeedItems =
    feedOrder.length > 0
      ? [
          ...feedOrder
            .map((id) => feedItemsByEventId.get(id))
            .filter((item): item is FeedItem => item !== undefined),
          ...nextFeedItems.filter(
            (item) =>
              !feedOrder.includes(item.type === 'note' ? item.event.id : item.repostEvent.id)
          ),
        ]
      : nextFeedItems;

  if (feedOrder.length === 0) {
    orderedFeedItems.sort((a, b) => b.timestamp - a.timestamp);
  }

  const repostedOriginalEvents = orderedFeedItems
    .filter((item): item is Extract<FeedItem, { type: 'repost' }> => item.type === 'repost')
    .map((item) => item.originalEvent)
    .filter((ev): ev is FeedEvent => ev !== undefined);

  const contentSources = [...notes, ...repostedOriginalEvents];
  const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
    collectReferencedIds(contentSources);

  const quotedEventsMap = new Map<string, FeedEvent>(embeddedMentionEvents);
  const missingQuotedIds = referencedEventIds.filter((id) => !quotedEventsMap.has(id));

  const neededPubkeys = new Set(inlineMentionPubkeys);
  for (const ev of embeddedMentionEvents.values()) neededPubkeys.add(ev.pubkey);
  for (const ev of repostedOriginalEvents) neededPubkeys.add(ev.pubkey);
  for (const note of notes) neededPubkeys.add(note.pubkey);
  const missingProfilePubkeys = Array.from(neededPubkeys).filter((pk) => !profilesMap.has(pk));

  for (const item of orderedFeedItems) {
    const metricId = item.type === 'note' ? item.event.id : item.originalEventId;
    if (!metricsMap.has(metricId)) metricsMap.set(metricId, { ...DEFAULT_METRICS });
  }

  // Fallback cursor: use oldest item timestamp when FeedRange didn't provide `until`
  if (paginationUntil === 0 && orderedFeedItems.length > 0) {
    for (const item of orderedFeedItems) {
      if (paginationUntil === 0 || item.timestamp < paginationUntil) {
        paginationUntil = item.timestamp;
      }
    }
  }

  if (perfLogTag) {
    const duration = Math.round((performance.now() - t0) * 100) / 100;
    if (duration > 50) {
      log.warn(`${perfLogTag}.slow`, {
        duration_ms: duration,
        rawEvents: feedRawEvents.length,
        feedItems: orderedFeedItems.length,
        profiles: profilesMap.size,
      });
    } else {
      log.debug(`${perfLogTag}.done`, {
        duration_ms: duration,
        rawEvents: feedRawEvents.length,
        feedItems: orderedFeedItems.length,
      });
    }
  }

  return {
    orderedFeedItems,
    metricsMap,
    profilesMap,
    quotedEventsMap,
    missingQuotedIds,
    missingProfilePubkeys,
    paginationUntil,
    paginationOffset: feedOrder.length || orderedFeedItems.length,
  };
}

/**
 * Shared enrichment: fetch missing quoted events and profiles for a page of feed items.
 * Used by both HomeFeed and UserFeed during initial load and pagination.
 */
export async function enrichFeedPage(
  client: ReturnType<typeof createPrimalRelayClient>,
  requestPrefix: string,
  missingQuotedIds: string[],
  missingProfilePubkeys: string[],
  existingQuoted: Map<string, FeedEvent>,
  existingProfiles: Map<string, ProfileInfo>,
  onUpdate: (updates: {
    quotedEvents?: Map<string, FeedEvent>;
    metrics?: Map<string, NoteMetrics>;
    profiles?: Map<string, ProfileInfo>;
  }) => void
): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (missingQuotedIds.length > 0) {
    tasks.push(
      client
        .request(`${requestPrefix}_eq`, { cache: ['events', { event_ids: missingQuotedIds }] })
        .then((evts) => {
          const xQ = new Map<string, FeedEvent>();
          const xM = new Map<string, NoteMetrics>();
          const xP = new Map<string, ProfileInfo>();
          for (const raw of evts) {
            if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
              const p = parseJson<Record<string, unknown>>(raw.content);
              const eid = typeof p?.event_id === 'string' ? p.event_id : undefined;
              if (!eid || !p) continue;
              xM.set(eid, parseNoteMetrics(p));
              continue;
            }
            if (raw.kind === Metadata) {
              const r = parseProfileFromRaw(raw);
              if (r) xP.set(r[0], r[1]);
              continue;
            }
            const ev = normalizeFeedEvent(raw);
            if (ev) xQ.set(ev.id, ev);
          }
          const updates: Parameters<typeof onUpdate>[0] = {};
          if (xQ.size > 0) updates.quotedEvents = xQ;
          if (xM.size > 0) updates.metrics = xM;
          if (xP.size > 0) updates.profiles = xP;
          if (Object.keys(updates).length > 0) onUpdate(updates);
        })
    );
  }

  if (missingProfilePubkeys.length > 0) {
    tasks.push(
      client
        .request(`${requestPrefix}_ep`, {
          cache: ['user_infos', { pubkeys: missingProfilePubkeys }],
        })
        .then((evts) => {
          const xP = new Map<string, ProfileInfo>();
          for (const raw of evts) {
            if (raw.kind !== Metadata) continue;
            const r = parseProfileFromRaw(raw);
            if (r) xP.set(r[0], r[1]);
          }
          if (xP.size > 0) onUpdate({ profiles: xP });
        })
    );
  }

  await Promise.all(tasks);
}
