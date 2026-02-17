/**
 * @fileoverview User Feed Component
 *
 * Displays a Nostr user's Kind 1 (text note) feed with engagement metrics
 * and rich content rendering.
 *
 * ## Engagement metrics
 * - Like count (Kind 7 reactions)
 * - Repost count (Kind 6 reposts)
 * - Reply count (Kind 1 replies referencing the post)
 *
 * ## Rich content parsing (NIP-19/NIP-27 + media)
 * - nostr:npub / nostr:nprofile → tappable @mention linking to profile
 * - nostr:nevent / nostr:note   → inline quoted-post preview card with avatar
 * - nostr:naddr                 → article reference badge
 * - Image URLs                  → inline image (expo-image)
 * - Video URLs                  → inline video player (expo-video)
 * - Regular URLs                → tappable link
 * - #hashtags                   → styled hashtag text
 * - Lightning invoices (lnbc…)  → tappable payment card
 * - Newlines                    → preserved
 *
 * Uses Primal's cache relay API for bundled feed lookups.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState, useTransition } from 'react';
import {
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Linking,
  Dimensions,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import { useTheme } from 'providers/ThemeProvider';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Skeleton } from 'components/ui/Skeleton';
import { Avatar } from 'components/ui/Avatar';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { ShortTextNote, Repost, GenericRepost, Metadata } from 'nostr-tools/kinds';
import { nip19 } from 'nostr-tools';

const SCREEN_WIDTH = Dimensions.get('window').width;
const CONTENT_WIDTH = SCREEN_WIDTH - 32; // 16px padding each side

// ============================================================================
// Types
// ============================================================================

interface UserFeedProps {
  pubkey: string;
  /** Author info passed from the profile screen so we don't re-fetch */
  authorName?: string;
  authorPicture?: string;
}

interface NoteMetrics {
  likeCount: number;
  repostCount: number;
  replyCount: number;
}

interface FeedEvent {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
}

interface RawPrimalEvent {
  kind: number;
  content: string;
  id?: string;
  pubkey?: string;
  created_at?: number;
  tags?: string[][];
}

/** Profile info stored for both inline mentions and quoted post authors */
interface ProfileInfo {
  name: string;
  picture?: string;
}

/** Unified feed item — either an original note or a repost (Kind 6/16) */
type FeedItem =
  | { type: 'note'; event: FeedEvent; timestamp: number }
  | {
      type: 'repost';
      repostEvent: FeedEvent;
      originalEvent: FeedEvent | undefined;
      originalEventId: string;
      timestamp: number;
    };

/**
 * Every segment the parser can produce. A note's content is turned into
 * an ordered list of these, then each is rendered by its own component.
 */
type ContentSegment =
  | { kind: 'text'; text: string }
  | { kind: 'newline' }
  | { kind: 'url'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'hashtag'; tag: string }
  | { kind: 'lightning'; invoice: string }
  | { kind: 'npub'; pubkey: string; bech32: string }
  | { kind: 'nprofile'; pubkey: string; bech32: string }
  | { kind: 'nevent'; eventId: string }
  | { kind: 'note'; eventId: string }
  | { kind: 'naddr'; identifier: string };

// ============================================================================
// Constants / regex
// ============================================================================

/** Shared empty map — used by QuotedPostCard / RepostCard to prevent quote recursion */
const EMPTY_QUOTED_EVENTS: Map<string, FeedEvent> = new Map();
/** Shared default for cache misses so we don't allocate a new object every call */
const DEFAULT_METRICS: NoteMetrics = Object.freeze({ likeCount: 0, repostCount: 0, replyCount: 0 });
const PRIMAL_CACHE_RELAY_URL = 'wss://cache2.primal.net/v1';
const PRIMAL_KIND_NOTE_STATS = 10000100;
const PRIMAL_KIND_MENTIONS = 10000107;
const PRIMAL_KIND_FEED_RANGE = 10000113;

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i;
const LIGHTNING_INVOICE_REGEX = /\b(lnbc[a-z0-9]{20,})\b/gi;
const HASHTAG_REGEX = /#([a-zA-Z][a-zA-Z0-9_]*)/g;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const NOSTR_URI_REGEX = /nostr:(npub1|nprofile1|nevent1|note1|naddr1)[a-z0-9]+/gi;

// ============================================================================
// Content parser (with memoization — avoids redundant regex work when the same
// content string is parsed by both collectReferencedIds and NoteContent)
// ============================================================================

const _contentCache = new Map<string, ContentSegment[]>();
const _CONTENT_CACHE_MAX = 300;
const _npubCache = new Map<string, string>();

function parseContent(raw: string): ContentSegment[] {
  const cached = _contentCache.get(raw);
  if (cached) return cached;
  const result = _parseContentInner(raw);
  if (_contentCache.size >= _CONTENT_CACHE_MAX) _contentCache.clear();
  _contentCache.set(raw, result);
  return result;
}

/**
 * Single-pass content parser. Order of priority:
 * 1. nostr: entities  (highest — they can contain long random chars)
 * 2. Lightning invoices
 * 3. URLs (then classify as image / video / regular link)
 * 4. Hashtags
 * 5. Newlines
 * 6. Plain text
 */
function _parseContentInner(raw: string): ContentSegment[] {
  type Span = { start: number; end: number; seg: ContentSegment };
  const spans: Span[] = [];

  // --- nostr: entities ---
  for (const m of raw.matchAll(NOSTR_URI_REGEX)) {
    const bech32 = m[0].replace('nostr:', '');
    try {
      const decoded = nip19.decode(bech32);
      let seg: ContentSegment;
      switch (decoded.type) {
        case 'npub':
          seg = { kind: 'npub', pubkey: decoded.data as string, bech32 };
          break;
        case 'nprofile':
          seg = {
            kind: 'nprofile',
            pubkey: (decoded.data as nip19.ProfilePointer).pubkey,
            bech32,
          };
          break;
        case 'nevent':
          seg = { kind: 'nevent', eventId: (decoded.data as nip19.EventPointer).id };
          break;
        case 'note':
          seg = { kind: 'note', eventId: decoded.data as string };
          break;
        case 'naddr':
          seg = {
            kind: 'naddr',
            identifier: (decoded.data as nip19.AddressPointer).identifier,
          };
          break;
        default:
          continue;
      }
      spans.push({ start: m.index!, end: m.index! + m[0].length, seg });
    } catch {
      // skip undecodable
    }
  }

  // --- Lightning invoices ---
  for (const m of raw.matchAll(LIGHTNING_INVOICE_REGEX)) {
    spans.push({
      start: m.index!,
      end: m.index! + m[0].length,
      seg: { kind: 'lightning', invoice: m[0] },
    });
  }

  // --- URLs (classify further into image / video / link) ---
  for (const m of raw.matchAll(URL_REGEX)) {
    const url = m[0];
    let seg: ContentSegment;
    if (IMAGE_EXT.test(url)) {
      seg = { kind: 'image', url };
    } else if (VIDEO_EXT.test(url)) {
      seg = { kind: 'video', url };
    } else {
      seg = { kind: 'url', url };
    }
    spans.push({ start: m.index!, end: m.index! + m[0].length, seg });
  }

  // --- Hashtags ---
  for (const m of raw.matchAll(HASHTAG_REGEX)) {
    spans.push({
      start: m.index!,
      end: m.index! + m[0].length,
      seg: { kind: 'hashtag', tag: m[1] },
    });
  }

  // Remove overlapping spans — higher-priority patterns were added first
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const cleaned: Span[] = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start >= cursor) {
      cleaned.push(sp);
      cursor = sp.end;
    }
  }

  // Fill gaps with text + newlines
  const segments: ContentSegment[] = [];
  let pos = 0;

  for (const sp of cleaned) {
    if (sp.start > pos) pushTextWithNewlines(segments, raw.slice(pos, sp.start));
    segments.push(sp.seg);
    pos = sp.end;
  }
  if (pos < raw.length) pushTextWithNewlines(segments, raw.slice(pos));

  // Strip leading and trailing newlines from the final output
  while (segments.length > 0 && segments[0].kind === 'newline') segments.shift();
  while (segments.length > 0 && segments[segments.length - 1].kind === 'newline') segments.pop();

  return segments;
}

/** Split a text chunk on newlines (max one consecutive newline kept). */
function pushTextWithNewlines(out: ContentSegment[], text: string) {
  const lines = text.split('\n');
  let lastWasNewline = out.length > 0 && out[out.length - 1].kind === 'newline';

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      out.push({ kind: 'text', text: lines[i] });
      lastWasNewline = false;
    }
    // Only emit a newline if we haven't just emitted one
    if (i < lines.length - 1 && !lastWasNewline) {
      out.push({ kind: 'newline' });
      lastWasNewline = true;
    }
  }
}

/**
 * Collect every referenced event ID and pubkey from a set of notes
 * so we can subscribe to them in bulk.
 */
function collectReferencedIds(notes: FeedEvent[]): {
  eventIds: string[];
  pubkeys: string[];
} {
  const eventIdSet = new Set<string>();
  const pubkeySet = new Set<string>();

  for (const note of notes) {
    for (const seg of parseContent(note.content)) {
      if (seg.kind === 'nevent' || seg.kind === 'note') eventIdSet.add(seg.eventId);
      else if (seg.kind === 'npub' || seg.kind === 'nprofile') pubkeySet.add(seg.pubkey);
    }
  }

  return { eventIds: Array.from(eventIdSet), pubkeys: Array.from(pubkeySet) };
}

// ============================================================================
// Small helpers
// ============================================================================

function formatTimestamp(unixTimestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - unixTimestamp;

  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;

  const date = new Date(unixTimestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function isRootNote(event: FeedEvent): boolean {
  const eTags = (event.tags || []).filter((t) => t[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((t) => t[3] === 'mention');
}

function tryNpubEncode(hex: string): string {
  const cached = _npubCache.get(hex);
  if (cached) return cached;
  try {
    const encoded = nip19.npubEncode(hex);
    // Very small cache to avoid repeated expensive bech32 encoding in large feeds.
    if (_npubCache.size > 600) _npubCache.clear();
    _npubCache.set(hex, encoded);
    return encoded;
  } catch {
    return '';
  }
}

function prettifyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname === '/' ? '' : u.pathname;
    const display = host + path;
    return display.length > 40 ? display.slice(0, 37) + '…' : display;
  } catch {
    return raw.length > 40 ? raw.slice(0, 37) + '…' : raw;
  }
}

function normalizeFeedEvent(value: unknown): FeedEvent | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== 'string' ||
    typeof input.kind !== 'number' ||
    typeof input.pubkey !== 'string' ||
    typeof input.content !== 'string' ||
    typeof input.created_at !== 'number' ||
    !Array.isArray(input.tags)
  ) {
    return null;
  }

  return {
    id: input.id,
    kind: input.kind,
    pubkey: input.pubkey,
    content: input.content,
    created_at: input.created_at,
    tags: input.tags.filter(Array.isArray) as string[][],
  };
}

function normalizeRawPrimalEvent(value: unknown): RawPrimalEvent | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.kind !== 'number' || typeof input.content !== 'string') {
    return null;
  }
  return {
    kind: input.kind,
    content: input.content,
    id: typeof input.id === 'string' ? input.id : undefined,
    pubkey: typeof input.pubkey === 'string' ? input.pubkey : undefined,
    created_at: typeof input.created_at === 'number' ? input.created_at : undefined,
    tags: Array.isArray(input.tags) ? (input.tags.filter(Array.isArray) as string[][]) : undefined,
  };
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function getFirstTagValue(event: FeedEvent, tagName: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag?.[1];
}

function getEmbeddedRepostEvent(
  repostEvent: FeedEvent,
  expectedEventId?: string
): FeedEvent | undefined {
  if (!repostEvent.content) return undefined;
  const parsed = normalizeFeedEvent(parseJson<unknown>(repostEvent.content));
  if (!parsed) return undefined;
  if (expectedEventId && parsed.id !== expectedEventId) return undefined;
  return parsed;
}

function parseProfileFromRaw(raw: RawPrimalEvent): [string, ProfileInfo] | null {
  if (!raw.pubkey) return null;
  const parsed = parseJson<Record<string, unknown>>(raw.content);
  const name =
    (typeof parsed?.display_name === 'string' && parsed.display_name) ||
    (typeof parsed?.name === 'string' && parsed.name);
  const picture = typeof parsed?.picture === 'string' ? parsed.picture : undefined;
  if (!name) return null;
  return [raw.pubkey, { name, picture }];
}

interface Phase1Result {
  orderedFeedItems: FeedItem[];
  metricsMap: Map<string, NoteMetrics>;
  profilesMap: Map<string, ProfileInfo>;
  quotedEventsMap: Map<string, FeedEvent>;
  missingQuotedIds: string[];
  missingProfilePubkeys: string[];
}

function parsePhase1(
  feedRawEvents: RawPrimalEvent[],
  pubkey: string,
  authorName?: string,
  authorPicture?: string
): Phase1Result {
  const eventMap = new Map<string, FeedEvent>();
  const userAuthoredPosts: FeedEvent[] = [];
  const embeddedMentionEvents = new Map<string, FeedEvent>();
  const metricsMap = new Map<string, NoteMetrics>();
  const profilesMap = new Map<string, ProfileInfo>();
  let feedOrder: string[] = [];

  for (const raw of feedRawEvents) {
    if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      const eventId = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
      if (!eventId) continue;
      metricsMap.set(eventId, {
        likeCount: typeof parsed?.likes === 'number' ? parsed.likes : 0,
        repostCount: typeof parsed?.reposts === 'number' ? parsed.reposts : 0,
        replyCount: typeof parsed?.replies === 'number' ? parsed.replies : 0,
      });
      continue;
    }

    if (raw.kind === PRIMAL_KIND_FEED_RANGE) {
      const parsed = parseJson<Record<string, unknown>>(raw.content);
      if (Array.isArray(parsed?.elements)) {
        feedOrder = parsed.elements.filter((id): id is string => typeof id === 'string');
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

    if (ev.kind === ShortTextNote || ev.kind === Repost || ev.kind === GenericRepost) {
      eventMap.set(ev.id, ev);
      if (ev.pubkey === pubkey) userAuthoredPosts.push(ev);
      continue;
    }

    if (ev.kind === Metadata) {
      const result = parseProfileFromRaw(raw);
      if (result) profilesMap.set(result[0], result[1]);
      continue;
    }
  }

  if (authorName) {
    profilesMap.set(pubkey, { name: authorName, picture: authorPicture });
  }

  const rootNotes = userAuthoredPosts.filter((ev) => ev.kind === ShortTextNote && isRootNote(ev));
  const userRepostEvents = userAuthoredPosts.filter(
    (ev) => ev.kind === Repost || ev.kind === GenericRepost
  );

  const nextFeedItems: FeedItem[] = [];
  const feedItemsByEventId = new Map<string, FeedItem>();

  for (const note of rootNotes) {
    const item: FeedItem = { type: 'note', event: note, timestamp: note.created_at || 0 };
    nextFeedItems.push(item);
    feedItemsByEventId.set(note.id, item);
  }

  for (const repostEvent of userRepostEvents) {
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

  const contentSources = [...rootNotes, ...repostedOriginalEvents];
  const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } =
    collectReferencedIds(contentSources);

  const quotedEventsMap = new Map<string, FeedEvent>(embeddedMentionEvents);
  const missingQuotedIds = referencedEventIds.filter((id) => !quotedEventsMap.has(id));

  const neededPubkeys = new Set(inlineMentionPubkeys);
  for (const ev of embeddedMentionEvents.values()) neededPubkeys.add(ev.pubkey);
  for (const ev of repostedOriginalEvents) neededPubkeys.add(ev.pubkey);
  const missingProfilePubkeys = Array.from(neededPubkeys).filter((pk) => !profilesMap.has(pk));

  for (const item of orderedFeedItems) {
    const metricId = item.type === 'note' ? item.event.id : item.originalEventId;
    if (!metricsMap.has(metricId)) metricsMap.set(metricId, { ...DEFAULT_METRICS });
  }

  return {
    orderedFeedItems,
    metricsMap,
    profilesMap,
    quotedEventsMap,
    missingQuotedIds,
    missingProfilePubkeys,
  };
}

type RelayMessage =
  | ['EVENT', string, unknown]
  | ['EVENTS', string, unknown[]]
  | ['EOSE', string]
  | ['NOTICE', string]
  | ['OK', string, boolean, string];

function createPrimalRelayClient(url: string) {
  const ws = new WebSocket(url);
  const OPEN_TIMEOUT_MS = 8000;
  const REQUEST_TIMEOUT_MS = 10000;
  const inflight = new Map<
    string,
    { events: RawPrimalEvent[]; resolve: (events: RawPrimalEvent[]) => void }
  >();
  let openSettled = false;

  const failAll = () => {
    inflight.forEach(({ resolve }) => resolve([]));
    inflight.clear();
  };

  ws.onmessage = (msg) => {
    if (typeof msg.data !== 'string') return;
    const parsed = parseJson<RelayMessage>(msg.data);
    if (!parsed || !Array.isArray(parsed)) return;

    if (parsed[0] === 'EVENT') {
      const subId = parsed[1];
      const active = inflight.get(subId);
      if (!active) return;
      const normalized = normalizeRawPrimalEvent(parsed[2]);
      if (normalized) active.events.push(normalized);
      return;
    }

    if (parsed[0] === 'EVENTS') {
      const subId = parsed[1];
      const active = inflight.get(subId);
      if (!active) return;
      for (const rawEvent of parsed[2]) {
        const normalized = normalizeRawPrimalEvent(rawEvent);
        if (normalized) active.events.push(normalized);
      }
      return;
    }

    if (parsed[0] === 'EOSE') {
      const subId = parsed[1];
      const active = inflight.get(subId);
      if (!active) return;
      active.resolve(active.events);
      inflight.delete(subId);
      return;
    }
  };

  ws.onerror = failAll;
  ws.onclose = failAll;

  const openPromise = new Promise<boolean>((resolve) => {
    const settle = (value: boolean) => {
      if (openSettled) return;
      openSettled = true;
      resolve(value);
    };

    if (ws.readyState === WebSocket.OPEN) {
      settle(true);
      return;
    }

    const timeoutId = setTimeout(() => settle(false), OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timeoutId);
      settle(true);
    };
    ws.onerror = () => {
      clearTimeout(timeoutId);
      failAll();
      settle(false);
    };
    ws.onclose = () => {
      clearTimeout(timeoutId);
      failAll();
      settle(false);
    };
  });

  const request = async (subId: string, filter: Record<string, unknown>) => {
    const isOpen = await openPromise;
    if (!isOpen || ws.readyState !== WebSocket.OPEN) return [];

    return new Promise<RawPrimalEvent[]>((resolve) => {
      const requestState = { events: [] as RawPrimalEvent[], resolve };
      const timeoutId = setTimeout(() => {
        const active = inflight.get(subId);
        if (!active) return;
        inflight.delete(subId);
        resolve(active.events);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(['CLOSE', subId]));
        }
      }, REQUEST_TIMEOUT_MS);

      inflight.set(subId, {
        events: requestState.events,
        resolve: (events) => {
          clearTimeout(timeoutId);
          resolve(events);
        },
      });
      ws.send(JSON.stringify(['REQ', subId, filter]));
    });
  };

  return {
    request,
    close: () => {
      ws.close();
    },
  };
}

// ============================================================================
// Segment renderers (inline — inside a <Text> wrapper)
// ============================================================================

const InlineMention = React.memo(function InlineMention({
  pubkey,
  bech32,
  profiles,
}: {
  pubkey: string;
  bech32: string;
  profiles: Map<string, ProfileInfo>;
}) {
  const { getPrimaryColor } = useTheme();
  const profile = profiles.get(pubkey);
  const label = profile?.name || `${bech32.slice(0, 12)}…`;

  return (
    <Text
      bold
      size={15}
      style={{ color: opacity(getPrimaryColor('0'), 0.5) }}
      onPress={() => {
        router.push({ pathname: '/(user-flow)/profile' as any, params: { pubkey } });
      }}>
      @{label}
    </Text>
  );
});

const InlineHashtag = React.memo(function InlineHashtag({ tag }: { tag: string }) {
  const { getPrimaryColor } = useTheme();
  return (
    <Text bold size={15} style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
      #{tag}
    </Text>
  );
});

const InlineLink = React.memo(function InlineLink({ url }: { url: string }) {
  const { getPrimaryColor } = useTheme();
  return (
    <Text
      size={15}
      style={{ color: opacity(getPrimaryColor('0'), 0.5) }}
      onPress={() => Linking.openURL(url).catch(() => {})}>
      {prettifyUrl(url)}
    </Text>
  );
});

// ============================================================================
// Block renderers (full-width — rendered outside the text flow)
// ============================================================================

/** Inline image with auto aspect-ratio */
const ImageBlock = React.memo(function ImageBlock({ url }: { url: string }) {
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [error, setError] = useState(false);

  if (error) return null;

  return (
    <View style={styles.imageBlockOuter}>
      <Image
        source={{ uri: url }}
        style={{ width: CONTENT_WIDTH - 32, aspectRatio, borderRadius: 12 }}
        contentFit="cover"
        placeholder={{ blurhash: '000000' }}
        transition={300}
        onLoad={(e) => {
          const { width, height } = e.source;
          if (width && height) setAspectRatio(width / height);
        }}
        onError={() => setError(true)}
      />
    </View>
  );
});

/** iOS inline video player using expo-video */
const IOSVideoBlock = React.memo(function IOSVideoBlock({ url }: { url: string }) {
  const { getPrimaryColor } = useTheme();
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.muted = true;
  });

  return (
    <View style={[styles.videoBlockOuter, { backgroundColor: getPrimaryColor('900') }]}>
      <VideoView
        player={player}
        style={{ width: CONTENT_WIDTH - 32, aspectRatio: 16 / 9 }}
        contentFit="contain"
        nativeControls
      />
    </View>
  );
});

/** Android fallback while expo-video has native mounting issues on profile switches. */
const AndroidVideoBlock = React.memo(function AndroidVideoBlock({ url }: { url: string }) {
  const { getPrimaryColor } = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => Linking.openURL(url).catch(() => {})}
      style={[
        styles.mediaCard,
        { backgroundColor: getPrimaryColor('900'), borderColor: getPrimaryColor('700') },
      ]}>
      <HStack align="center" gap={8}>
        <Icon name="mdi:play-circle-outline" size={20} color={opacity(getPrimaryColor('0'), 0.4)} />
        <VStack style={styles.flex1}>
          <Text bold size={13} style={{ color: opacity(getPrimaryColor('0'), 0.66) }}>
            Video
          </Text>
          <Text size={11} numberOfLines={1} style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
            Open in browser
          </Text>
        </VStack>
        <Icon name="mdi:open-in-new" size={16} color={opacity(getPrimaryColor('0'), 0.33)} />
      </HStack>
    </TouchableOpacity>
  );
});

const VideoBlock = React.memo(function VideoBlock({ url }: { url: string }) {
  if (Platform.OS === 'android') {
    return <AndroidVideoBlock url={url} />;
  }
  return <IOSVideoBlock url={url} />;
});

/** Lightning invoice card */
const LightningBlock = React.memo(function LightningBlock({ invoice }: { invoice: string }) {
  const { getPrimaryColor } = useTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        router.push({ pathname: '/(send-flow)/meltQuote' as any, params: { invoice } });
      }}
      style={[
        styles.mediaCard,
        { backgroundColor: getPrimaryColor('900'), borderColor: getPrimaryColor('700') },
      ]}>
      <HStack align="center" gap={8}>
        <Icon name="mingcute:lightning-fill" size={20} color={opacity(getPrimaryColor('0'), 0.4)} />
        <VStack style={styles.flex1}>
          <Text bold size={13} style={{ color: opacity(getPrimaryColor('0'), 0.66) }}>
            Lightning Invoice
          </Text>
          <Text size={11} numberOfLines={1} style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
            {invoice.slice(0, 30)}…
          </Text>
        </VStack>
        <Icon name="mdi:chevron-right" size={18} color={opacity(getPrimaryColor('0'), 0.33)} />
      </HStack>
    </TouchableOpacity>
  );
});

const MetricsFooter = React.memo(function MetricsFooter({
  metrics,
  borderColor,
  compact = false,
}: {
  metrics: NoteMetrics;
  borderColor: string;
  compact?: boolean;
}) {
  const iconColor = opacity(borderColor, 0.57);
  const textColor = opacity(borderColor, 0.57);
  const iconSize = compact ? 13 : 16;
  const textSize = compact ? 11 : 13;

  return (
    <View
      style={[
        styles.noteFooter,
        styles.footerBorder,
        { borderTopColor: opacity(borderColor, 0.1) },
      ]}>
      <HStack align="center">
        <View style={styles.metricItem}>
          <HStack align="center" gap={5} style={styles.metricRow}>
            <Icon
              name="garden:speech-bubble-typing-fill-12"
              size={iconSize - 1}
              color={iconColor}
            />
            <Text size={textSize} style={{ color: textColor }}>
              {formatCount(metrics.replyCount)}
            </Text>
          </HStack>
        </View>
        <View style={styles.metricItem}>
          <HStack align="center" gap={5} style={styles.metricRow}>
            <Icon name="garden:arrow-retweet-fill-16" size={iconSize + 1} color={iconColor} />
            <Text size={textSize} style={{ color: textColor }}>
              {formatCount(metrics.repostCount)}
            </Text>
          </HStack>
        </View>
        <View style={styles.metricItem}>
          <HStack align="center" gap={5} style={styles.metricRow}>
            <Icon name="garden:heart-fill-16" size={iconSize} color={iconColor} />
            <Text size={textSize} style={{ color: textColor }}>
              {formatCount(metrics.likeCount)}
            </Text>
          </HStack>
        </View>
      </HStack>
    </View>
  );
});

// ============================================================================
// QuotedPostCard — inline preview of a referenced event with author avatar
// ============================================================================

const QuotedPostCard = React.memo(function QuotedPostCard({
  event,
  metrics,
  profiles,
  getMetrics,
}: {
  event: FeedEvent | undefined;
  metrics: NoteMetrics;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
}) {
  const { getPrimaryColor } = useTheme();

  if (!event) {
    return (
      <View
        style={[
          styles.quotedCard,
          { backgroundColor: getPrimaryColor('900'), borderColor: getPrimaryColor('700') },
        ]}>
        <HStack align="center" gap={6}>
          <Icon name="mdi:message-text" size={14} color={opacity(getPrimaryColor('0'), 0.33)} />
          <Text size={13} italic style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
            Quoted post
          </Text>
        </HStack>
        <MetricsFooter metrics={metrics} borderColor={getPrimaryColor('0')} compact />
      </View>
    );
  }

  const timestamp = event.created_at ? formatTimestamp(event.created_at) : '';
  const profile = profiles.get(event.pubkey);
  const displayName = profile?.name || `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        router.push({
          pathname: '/(user-flow)/profile' as any,
          params: { pubkey: event.pubkey },
        });
      }}>
      <View
        style={[
          styles.quotedCard,
          { backgroundColor: getPrimaryColor('900'), borderColor: getPrimaryColor('700') },
        ]}>
        {/* Author header */}
        <HStack align="center" gap={8} style={styles.mb6}>
          <Avatar
            picture={profile?.picture}
            seed={event.pubkey}
            size={24}
            variant="person"
            name={displayName}
          />
          <Text
            bold
            size={13}
            style={{ color: opacity(getPrimaryColor('0'), 0.66), flex: 1 }}
            numberOfLines={1}>
            {displayName}
          </Text>
          {timestamp ? (
            <Text size={11} semibold style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
              {timestamp}
            </Text>
          ) : null}
        </HStack>
        {/* Body — full rich rendering (images, links, etc.) but no nested quotes */}
        <NoteContent
          content={event.content}
          quotedEvents={EMPTY_QUOTED_EVENTS}
          profiles={profiles}
          getMetrics={getMetrics}
        />
        <MetricsFooter metrics={metrics} borderColor={getPrimaryColor('0')} compact />
      </View>
    </TouchableOpacity>
  );
});

// ============================================================================
// NoteContent — renders parsed segments
// ============================================================================

const NoteContent = React.memo(function NoteContent({
  content,
  quotedEvents,
  profiles,
  getMetrics,
}: {
  content: string;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
}) {
  const { getPrimaryColor } = useTheme();

  // Parse + split into inline vs block in one memo — avoids re-splitting on every render
  const { inlineSegments, blockSegments } = useMemo(() => {
    const segments = parseContent(content);
    const inline: ContentSegment[] = [];
    const blocks: ContentSegment[] = [];

    for (const seg of segments) {
      switch (seg.kind) {
        case 'image':
        case 'video':
        case 'lightning':
        case 'nevent':
        case 'note':
          blocks.push(seg);
          break;
        default:
          inline.push(seg);
      }
    }

    // Trim trailing newlines from inline
    while (inline.length > 0 && inline[inline.length - 1].kind === 'newline') {
      inline.pop();
    }

    return { inlineSegments: inline, blockSegments: blocks };
  }, [content]);

  const hasInline = inlineSegments.length > 0;
  const hasBlocks = blockSegments.length > 0;

  return (
    <VStack gap={0}>
      {/* Inline text flow */}
      {hasInline && (
        <Text size={15} style={{ color: opacity(getPrimaryColor('0'), 0.9), lineHeight: 22 }}>
          {inlineSegments.map((seg, i) => {
            switch (seg.kind) {
              case 'text':
                return <React.Fragment key={i}>{seg.text}</React.Fragment>;
              case 'newline':
                return <React.Fragment key={i}>{'\n'}</React.Fragment>;
              case 'npub':
              case 'nprofile':
                return (
                  <InlineMention
                    key={i}
                    pubkey={seg.pubkey}
                    bech32={seg.bech32}
                    profiles={profiles}
                  />
                );
              case 'hashtag':
                return <InlineHashtag key={i} tag={seg.tag} />;
              case 'url':
                return <InlineLink key={i} url={seg.url} />;
              case 'naddr':
                return (
                  <Text
                    key={i}
                    bold
                    size={15}
                    style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
                    [article]
                  </Text>
                );
              default:
                return null;
            }
          })}
        </Text>
      )}

      {/* Block-level media / embeds */}
      {hasBlocks &&
        blockSegments.map((seg, i) => {
          switch (seg.kind) {
            case 'image':
              return <ImageBlock key={`b${i}`} url={seg.url} />;
            case 'video':
              return <VideoBlock key={`b${i}`} url={seg.url} />;
            case 'lightning':
              return <LightningBlock key={`b${i}`} invoice={seg.invoice} />;
            case 'nevent':
            case 'note':
              return (
                <QuotedPostCard
                  key={`b${i}`}
                  event={quotedEvents.get(seg.eventId)}
                  metrics={getMetrics(seg.eventId)}
                  profiles={profiles}
                  getMetrics={getMetrics}
                />
              );
            default:
              return null;
          }
        })}
    </VStack>
  );
});

// ============================================================================
// Note Card Component
// ============================================================================

const NoteCard = React.memo(function NoteCard({
  event,
  metrics,
  index,
  quotedEvents,
  profiles,
  getMetrics,
  authorName,
  authorPicture,
  authorPubkey,
}: {
  event: FeedEvent;
  metrics: NoteMetrics;
  index: number;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  authorName: string;
  authorPicture?: string;
  authorPubkey: string;
}) {
  const { getPrimaryColor } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      delay: Math.min(index * 60, 300),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, index]);

  const timestamp = event.created_at ? formatTimestamp(event.created_at) : '';

  return (
    <Animated.View
      style={[
        styles.noteCard,
        {
          backgroundColor: getPrimaryColor('800'),
          borderColor: getPrimaryColor('700'),
          opacity: fadeAnim,
          transform: [
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}>
      {/* Author header */}
      <HStack align="center" gap={10} style={styles.mb10}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() =>
            router.push({
              pathname: '/(user-flow)/profile' as any,
              params: { pubkey: authorPubkey },
            })
          }>
          <Avatar
            picture={authorPicture}
            seed={authorPubkey}
            size={36}
            variant="person"
            name={authorName}
          />
        </TouchableOpacity>
        <VStack style={styles.flex1}>
          <Text bold size={14} style={{ color: opacity(getPrimaryColor('0'), 0.9) }}>
            {authorName}
          </Text>
        </VStack>
        <Text semibold size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4) }}>
          {timestamp}
        </Text>
      </HStack>

      {/* Content */}
      <NoteContent
        content={event.content}
        quotedEvents={quotedEvents}
        profiles={profiles}
        getMetrics={getMetrics}
      />

      <Spacer size={12} />

      {/* Footer: Engagement metrics — equally spaced across full width */}
      <MetricsFooter metrics={metrics} borderColor={getPrimaryColor('0')} />
    </Animated.View>
  );
});

// ============================================================================
// Repost Card — wraps the original post with a "reposted by" header
// ============================================================================

const RepostCard = React.memo(function RepostCard({
  repostEvent: _repostEvent,
  originalEvent,
  originalMetrics,
  index,
  quotedEvents,
  profiles,
  getMetrics,
  reposterName,
  reposterPubkey,
}: {
  repostEvent: FeedEvent;
  originalEvent: FeedEvent | undefined;
  originalMetrics: NoteMetrics;
  index: number;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  reposterName: string;
  reposterPubkey: string;
}) {
  const { getPrimaryColor } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      delay: Math.min(index * 60, 300),
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim, index]);

  // Original post author info
  const originalProfile = originalEvent ? profiles.get(originalEvent.pubkey) : undefined;
  const originalName =
    originalProfile?.name ||
    (originalEvent ? `${tryNpubEncode(originalEvent.pubkey).slice(0, 12)}…` : '');
  const originalTimestamp = originalEvent?.created_at
    ? formatTimestamp(originalEvent.created_at)
    : '';

  return (
    <Animated.View
      style={[
        styles.noteCard,
        {
          backgroundColor: getPrimaryColor('800'),
          borderColor: getPrimaryColor('700'),
          opacity: fadeAnim,
          transform: [
            {
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}>
      {/* Repost header */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() =>
          router.push({
            pathname: '/(user-flow)/profile' as any,
            params: { pubkey: reposterPubkey },
          })
        }>
        <HStack align="center" gap={6} style={styles.mb10}>
          <Icon
            name="garden:arrow-retweet-fill-16"
            size={14}
            color={opacity(getPrimaryColor('0'), 0.33)}
          />
          <Text size={12} semibold style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
            {reposterName} reposted
          </Text>
        </HStack>
      </TouchableOpacity>

      {/* Original post content */}
      {originalEvent ? (
        <View>
          {/* Original author header */}
          <HStack align="center" gap={10} style={styles.mb10}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() =>
                router.push({
                  pathname: '/(user-flow)/profile' as any,
                  params: { pubkey: originalEvent.pubkey },
                })
              }>
              <Avatar
                picture={originalProfile?.picture}
                seed={originalEvent.pubkey}
                size={36}
                variant="person"
                name={originalName}
              />
            </TouchableOpacity>
            <VStack style={styles.flex1}>
              <Text bold size={14} style={{ color: opacity(getPrimaryColor('0'), 0.9) }}>
                {originalName}
              </Text>
            </VStack>
            <Text semibold size={13} style={{ color: opacity(getPrimaryColor('0'), 0.4) }}>
              {originalTimestamp}
            </Text>
          </HStack>

          {/* Original post body — full rich rendering, no nested quote recursion */}
          <NoteContent
            content={originalEvent.content}
            quotedEvents={quotedEvents}
            profiles={profiles}
            getMetrics={getMetrics}
          />
        </View>
      ) : (
        <View
          style={[
            styles.quotedCard,
            {
              backgroundColor: getPrimaryColor('900'),
              borderColor: getPrimaryColor('700'),
              marginTop: 0,
            },
          ]}>
          <HStack align="center" gap={6}>
            <Icon name="mdi:message-text" size={14} color={opacity(getPrimaryColor('0'), 0.33)} />
            <Text size={13} italic style={{ color: opacity(getPrimaryColor('0'), 0.33) }}>
              Original post unavailable
            </Text>
          </HStack>
        </View>
      )}
      <Spacer size={12} />
      <MetricsFooter metrics={originalMetrics} borderColor={getPrimaryColor('0')} />
    </Animated.View>
  );
});

// ============================================================================
// Skeleton Loading Cards (matches final NoteCard layout closely)
// ============================================================================

function NoteCardSkeleton() {
  const { getPrimaryColor } = useTheme();

  return (
    <View
      style={[
        styles.noteCard,
        { backgroundColor: getPrimaryColor('800'), borderColor: getPrimaryColor('700') },
      ]}>
      {/* Author skeleton */}
      <HStack align="center" gap={10} style={styles.mb10}>
        <Skeleton
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: getPrimaryColor('700'),
          }}
        />
        <View style={styles.flex1}>
          <Skeleton
            style={{
              width: 110,
              height: 14,
              borderRadius: 4,
              backgroundColor: getPrimaryColor('700'),
            }}
          />
        </View>
        <Skeleton
          style={{
            width: 44,
            height: 13,
            borderRadius: 4,
            backgroundColor: getPrimaryColor('700'),
          }}
        />
      </HStack>

      {/* Content lines */}
      <VStack gap={8}>
        <Skeleton
          style={{
            width: '100%',
            height: 15,
            borderRadius: 4,
            backgroundColor: getPrimaryColor('700'),
          }}
        />
        <Skeleton
          style={{
            width: '85%',
            height: 15,
            borderRadius: 4,
            backgroundColor: getPrimaryColor('700'),
          }}
        />
        <Skeleton
          style={{
            width: '55%',
            height: 15,
            borderRadius: 4,
            backgroundColor: getPrimaryColor('700'),
          }}
        />
      </VStack>

      <Spacer size={12} />

      {/* Footer skeleton — 3 equal-width items */}
      <View
        style={[
          styles.noteFooter,
          styles.footerBorder,
          { borderTopColor: getPrimaryColor('700') },
        ]}>
        <HStack align="center">
          {[0, 1, 2].map((j) => (
            <View key={j} style={styles.metricItem}>
              <Skeleton
                style={{
                  width: 50,
                  height: 13,
                  borderRadius: 4,
                  backgroundColor: getPrimaryColor('700'),
                }}
              />
            </View>
          ))}
        </HStack>
      </View>
    </View>
  );
}

// ============================================================================
// Empty State
// ============================================================================

function EmptyFeed() {
  const { getPrimaryColor } = useTheme();

  return (
    <VStack align="center" style={styles.emptyState}>
      <Icon name="mdi:message-text" size={40} color={getPrimaryColor('600')} />
      <Spacer size={8} />
      <Text bold size={16} style={{ color: opacity(getPrimaryColor('0'), 0.5) }}>
        No posts yet
      </Text>
      <Spacer size={4} />
      <Text
        size={13}
        style={[styles.textAlignCenter, { color: opacity(getPrimaryColor('0'), 0.33) }]}>
        {"This user hasn't posted any notes."}
      </Text>
    </VStack>
  );
}

// ============================================================================
// Main UserFeed Component
// ============================================================================

function UserFeedComponent({ pubkey, authorName, authorPicture }: UserFeedProps) {
  const { getPrimaryColor } = useTheme();
  const [, startTransition] = useTransition();
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<string, NoteMetrics>>(new Map());
  const [quotedEventsMap, setQuotedEventsMap] = useState<Map<string, FeedEvent>>(new Map());
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileInfo>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!pubkey) {
      setFeedItems([]);
      setMetricsMap(new Map());
      setQuotedEventsMap(new Map());
      setProfilesMap(new Map());
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);

    const loadFeedFromPrimal = async () => {
      const client = createPrimalRelayClient(PRIMAL_CACHE_RELAY_URL);

      try {
        const requestPrefix = Date.now().toString(36);
        const feedRawEvents = await client.request(`${requestPrefix}_feed`, {
          cache: ['feed', { pubkey, notes: 'authored', limit: 50 }],
        });
        if (cancelled) return;

        const phase1 = parsePhase1(feedRawEvents, pubkey, authorName, authorPicture);
        setFeedItems(phase1.orderedFeedItems);
        setMetricsMap(phase1.metricsMap);
        setQuotedEventsMap(phase1.quotedEventsMap);
        setProfilesMap(phase1.profilesMap);
        setIsLoading(false);

        const phase2Promise = (async () => {
          if (phase1.missingQuotedIds.length === 0) return;

          const referencedRawEvents = await client.request(`${requestPrefix}_quoted`, {
            cache: ['events', { event_ids: phase1.missingQuotedIds }],
          });
          if (cancelled) return;

          const nextQuoted = new Map(phase1.quotedEventsMap);
          const extraProfiles = new Map<string, ProfileInfo>();
          const extraMetrics = new Map<string, NoteMetrics>();

          for (const raw of referencedRawEvents) {
            if (raw.kind === PRIMAL_KIND_NOTE_STATS) {
              const parsed = parseJson<Record<string, unknown>>(raw.content);
              const eventId = typeof parsed?.event_id === 'string' ? parsed.event_id : undefined;
              if (!eventId) continue;
              extraMetrics.set(eventId, {
                likeCount: typeof parsed?.likes === 'number' ? parsed.likes : 0,
                repostCount: typeof parsed?.reposts === 'number' ? parsed.reposts : 0,
                replyCount: typeof parsed?.replies === 'number' ? parsed.replies : 0,
              });
              continue;
            }

            if (raw.kind === Metadata) {
              const result = parseProfileFromRaw(raw);
              if (result) extraProfiles.set(result[0], result[1]);
              continue;
            }

            const ev = normalizeFeedEvent(raw);
            if (!ev) continue;
            nextQuoted.set(ev.id, ev);
          }

          if (cancelled) return;
          startTransition(() => {
            setQuotedEventsMap(nextQuoted);

            if (extraMetrics.size > 0) {
              setMetricsMap((prev) => {
                const next = new Map(prev);
                for (const [k, v] of extraMetrics) next.set(k, v);
                return next;
              });
            }

            if (extraProfiles.size > 0) {
              setProfilesMap((prev) => {
                const next = new Map(prev);
                for (const [k, v] of extraProfiles) next.set(k, v);
                return next;
              });
            }
          });
        })();

        const phase3Promise = (async () => {
          if (phase1.missingProfilePubkeys.length === 0) return;

          const profileRawEvents = await client.request(`${requestPrefix}_profiles`, {
            cache: ['user_infos', { pubkeys: phase1.missingProfilePubkeys }],
          });
          if (cancelled) return;

          const extraProfiles = new Map<string, ProfileInfo>();
          for (const raw of profileRawEvents) {
            if (raw.kind !== Metadata) continue;
            const result = parseProfileFromRaw(raw);
            if (result) extraProfiles.set(result[0], result[1]);
          }

          if (cancelled || extraProfiles.size === 0) return;
          startTransition(() => {
            setProfilesMap((prev) => {
              const next = new Map(prev);
              for (const [k, v] of extraProfiles) next.set(k, v);
              return next;
            });
          });
        })();

        await Promise.all([phase2Promise, phase3Promise]);
      } catch (error) {
        console.error('UserFeed: Failed to load Primal cached feed', error);
        if (!cancelled) {
          setFeedItems([]);
          setMetricsMap(new Map());
          setQuotedEventsMap(new Map());
          setProfilesMap(new Map());
          setIsLoading(false);
        }
      } finally {
        client.close();
      }
    };

    loadFeedFromPrimal();

    return () => {
      cancelled = true;
    };
  }, [authorName, authorPicture, pubkey]);

  const getMetrics = useCallback(
    (noteId: string): NoteMetrics => metricsMap.get(noteId) || DEFAULT_METRICS,
    [metricsMap]
  );

  // ---------------------------
  // Render
  // ---------------------------
  const displayName = authorName || tryNpubEncode(pubkey).slice(0, 12) + '…';

  return (
    <View style={styles.feedContainer}>
      {/* Section title — styled the same as "Profile Info" (Section component) */}
      <Text
        medium
        overpass
        size={13}
        style={[styles.sectionTitle, { color: opacity(getPrimaryColor('0'), 0.5) }]}>
        Notes
      </Text>

      {isLoading ? (
        <VStack gap={12}>
          {[0, 1, 2].map((i) => (
            <NoteCardSkeleton key={i} />
          ))}
        </VStack>
      ) : feedItems.length === 0 ? (
        <EmptyFeed />
      ) : (
        <VStack gap={12}>
          {feedItems.map((item, index) => {
            if (item.type === 'note') {
              return (
                <NoteCard
                  key={item.event.id}
                  event={item.event}
                  metrics={getMetrics(item.event.id)}
                  index={index}
                  quotedEvents={quotedEventsMap}
                  profiles={profilesMap}
                  getMetrics={getMetrics}
                  authorName={displayName}
                  authorPicture={authorPicture}
                  authorPubkey={pubkey}
                />
              );
            }
            // Repost
            return (
              <RepostCard
                key={item.repostEvent.id}
                repostEvent={item.repostEvent}
                originalEvent={item.originalEvent}
                originalMetrics={getMetrics(item.originalEventId)}
                index={index}
                quotedEvents={quotedEventsMap}
                profiles={profilesMap}
                getMetrics={getMetrics}
                reposterName={displayName}
                reposterPubkey={pubkey}
              />
            );
          })}
        </VStack>
      )}
    </View>
  );
}

export const UserFeed = React.memo(UserFeedComponent);

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  noteCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
  },
  noteFooter: {},
  metricItem: {
    flex: 1,
    alignItems: 'center',
  },
  metricRow: {
    justifyContent: 'center',
  },
  quotedCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  mediaCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 6,
  },
  emptyState: {
    paddingVertical: 32,
    paddingHorizontal: 16,
  },
  // Repeated layout helpers
  flex1: {
    flex: 1,
  },
  mb6: {
    marginBottom: 6,
  },
  mb10: {
    marginBottom: 10,
  },
  imageBlockOuter: {
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  videoBlockOuter: {
    marginVertical: 6,
    borderRadius: 12,
    overflow: 'hidden',
  },
  feedContainer: {
    paddingHorizontal: 16,
  },
  footerBorder: {
    borderTopWidth: 1,
    paddingTop: 10,
  },
  textAlignCenter: {
    textAlign: 'center',
  },
  sectionTitle: {
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
    marginLeft: 12,
  },
});
