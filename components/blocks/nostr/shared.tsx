/**
 * @fileoverview Shared Nostr rendering components, types, utilities, and constants
 *
 * This module contains all shared code between UserFeed and ThreadView,
 * extracted to eliminate duplication and ensure consistent behavior.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, Linking, Dimensions, Platform } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { router } from 'expo-router';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Avatar } from 'components/ui/Avatar';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { nip19 } from 'nostr-tools';
import { ImageBlock, useImageOverlay } from './image-overlay';
import type { ImageOverlayLayout, ImageOverlayPost } from './image-overlay';
import { useThemeColor } from 'hooks/useThemeColor';

// ============================================================================
// Types
// ============================================================================

export interface NoteMetrics {
  likeCount: number;
  repostCount: number;
  replyCount: number;
  satsZapped: number;
}

export interface FeedEvent {
  id: string;
  kind: number;
  pubkey: string;
  content: string;
  tags: string[][];
  created_at: number;
}

export interface RawPrimalEvent {
  kind: number;
  content: string;
  id?: string;
  pubkey?: string;
  created_at?: number;
  tags?: string[][];
}

export interface ProfileInfo {
  name: string;
  picture?: string;
}

export type ContentSegment =
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

export type RelayMessage =
  | ['EVENT', string, unknown]
  | ['EVENTS', string, unknown[]]
  | ['EOSE', string]
  | ['NOTICE', string]
  | ['OK', string, boolean, string];

// ============================================================================
// Constants
// ============================================================================

export const SCREEN_WIDTH = Dimensions.get('window').width;
export const CONTENT_WIDTH = SCREEN_WIDTH;

export const EMPTY_QUOTED_EVENTS: Map<string, FeedEvent> = new Map();
export const DEFAULT_METRICS: NoteMetrics = Object.freeze({
  likeCount: 0,
  repostCount: 0,
  replyCount: 0,
  satsZapped: 0,
});

export const PRIMAL_CACHE_RELAY_URL = 'wss://cache2.primal.net/v1';
export const PRIMAL_KIND_NOTE_STATS = 10000100;
export const PRIMAL_KIND_MENTIONS = 10000107;
export const PRIMAL_KIND_FEED_RANGE = 10000113;

export const IMAGE_EXT = /\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i;
export const VIDEO_EXT = /\.(mp4|webm|mov|m4v|avi)(\?.*)?$/i;

const LIGHTNING_INVOICE_REGEX = /\b(lnbc[a-z0-9]{20,})\b/gi;
const HASHTAG_REGEX = /#([a-zA-Z][a-zA-Z0-9_]*)/g;
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi;
const NOSTR_URI_REGEX = /nostr:(npub1|nprofile1|nevent1|note1|naddr1)[a-z0-9]+/gi;

// ============================================================================
// Utility functions
// ============================================================================

export function getVideoUrlsFromContent(content: string): string[] {
  const urls: string[] = [];
  for (const m of content.matchAll(URL_REGEX)) {
    if (VIDEO_EXT.test(m[0])) {
      urls.push(m[0]);
    }
  }
  return urls;
}

export interface VideoPostRecord {
  eventId: string;
  videoUrl: string;
  content: string;
  pubkey: string;
  created_at: number;
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

// ============================================================================
// Content parser
// ============================================================================

const _contentCache = new Map<string, ContentSegment[]>();
const _CONTENT_CACHE_MAX = 300;
const _npubCache = new Map<string, string>();

export function parseContent(raw: string): ContentSegment[] {
  const cached = _contentCache.get(raw);
  if (cached) return cached;
  const result = _parseContentInner(raw);
  if (_contentCache.size >= _CONTENT_CACHE_MAX) _contentCache.clear();
  _contentCache.set(raw, result);
  return result;
}

function _parseContentInner(raw: string): ContentSegment[] {
  type Span = { start: number; end: number; seg: ContentSegment };
  const spans: Span[] = [];

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

  for (const m of raw.matchAll(LIGHTNING_INVOICE_REGEX)) {
    spans.push({
      start: m.index!,
      end: m.index! + m[0].length,
      seg: { kind: 'lightning', invoice: m[0] },
    });
  }

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

  for (const m of raw.matchAll(HASHTAG_REGEX)) {
    spans.push({
      start: m.index!,
      end: m.index! + m[0].length,
      seg: { kind: 'hashtag', tag: m[1] },
    });
  }

  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  const cleaned: Span[] = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start >= cursor) {
      cleaned.push(sp);
      cursor = sp.end;
    }
  }

  const segments: ContentSegment[] = [];
  let pos = 0;

  for (const sp of cleaned) {
    if (sp.start > pos) pushTextWithNewlines(segments, raw.slice(pos, sp.start));
    segments.push(sp.seg);
    pos = sp.end;
  }
  if (pos < raw.length) pushTextWithNewlines(segments, raw.slice(pos));

  while (segments.length > 0 && segments[0].kind === 'newline') segments.shift();
  while (segments.length > 0 && segments[segments.length - 1].kind === 'newline') segments.pop();

  return segments;
}

function pushTextWithNewlines(out: ContentSegment[], text: string) {
  const lines = text.split('\n');
  let lastWasNewline = out.length > 0 && out[out.length - 1].kind === 'newline';

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 0) {
      out.push({ kind: 'text', text: lines[i] });
      lastWasNewline = false;
    }
    if (i < lines.length - 1 && !lastWasNewline) {
      out.push({ kind: 'newline' });
      lastWasNewline = true;
    }
  }
}

export function collectReferencedIds(notes: FeedEvent[]): {
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

export function formatTimestamp(unixTimestamp: number): string {
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

export function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

export function formatSats(sats: number): string {
  if (sats >= 100_000_000) return `${(sats / 100_000_000).toFixed(2)} BTC`;
  if (sats >= 1_000_000) return `${(sats / 1_000_000).toFixed(1)}M`;
  if (sats >= 1_000) return `${(sats / 1_000).toFixed(1)}K`;
  return sats.toString();
}

export function parseNoteMetrics(parsed: Record<string, unknown>): NoteMetrics {
  return {
    likeCount: typeof parsed?.likes === 'number' ? parsed.likes : 0,
    repostCount: typeof parsed?.reposts === 'number' ? parsed.reposts : 0,
    replyCount: typeof parsed?.replies === 'number' ? parsed.replies : 0,
    satsZapped: typeof parsed?.satszapped === 'number' ? parsed.satszapped : 0,
  };
}

export function tryNpubEncode(hex: string): string {
  const cached = _npubCache.get(hex);
  if (cached) return cached;
  try {
    const encoded = nip19.npubEncode(hex);
    if (_npubCache.size > 600) _npubCache.clear();
    _npubCache.set(hex, encoded);
    return encoded;
  } catch {
    return '';
  }
}

export function prettifyUrl(raw: string): string {
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

export function normalizeFeedEvent(value: unknown): FeedEvent | null {
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

export function normalizeRawPrimalEvent(value: unknown): RawPrimalEvent | null {
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

export function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function getFirstTagValue(event: FeedEvent, tagName: string): string | undefined {
  const tag = event.tags.find((t) => t[0] === tagName);
  return tag?.[1];
}

export function parseProfileFromRaw(raw: RawPrimalEvent): [string, ProfileInfo] | null {
  if (!raw.pubkey) return null;
  const parsed = parseJson<Record<string, unknown>>(raw.content);
  const name =
    (typeof parsed?.display_name === 'string' && parsed.display_name) ||
    (typeof parsed?.name === 'string' && parsed.name);
  const picture = typeof parsed?.picture === 'string' ? parsed.picture : undefined;
  if (!name) return null;
  return [raw.pubkey, { name, picture }];
}

// ============================================================================
// Primal relay client
// ============================================================================

export function createPrimalRelayClient(url: string) {
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
    if (!parsed || !Array.isArray(parsed)) {
      console.log('[PrimalWS] non-array message:', String(msg.data).slice(0, 200));
      return;
    }
    console.log(
      '[PrimalWS] msg type:',
      parsed[0],
      'subId:',
      parsed[1],
      'inflight?',
      inflight.has(parsed[1] as string)
    );

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
// Inline renderers
// ============================================================================

export const InlineMention = React.memo(function InlineMention({
  pubkey,
  bech32,
  profiles,
  onPressIn,
  onPressOut,
}: {
  pubkey: string;
  bech32: string;
  profiles: Map<string, ProfileInfo>;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  const foreground = useThemeColor('foreground');
  const profile = profiles.get(pubkey);
  const label = profile?.name || `${bech32.slice(0, 12)}…`;

  return (
    <Text
      bold
      size={15}
      style={{ color: opacity(foreground, 0.5) }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => {
        router.navigate({ pathname: '/(user-flow)/profile' as any, params: { pubkey } });
      }}>
      @{label}
    </Text>
  );
});

export const InlineHashtag = React.memo(function InlineHashtag({ tag }: { tag: string }) {
  const foreground = useThemeColor('foreground');
  return (
    <Text bold size={15} style={{ color: opacity(foreground, 0.5) }}>
      #{tag}
    </Text>
  );
});

export const InlineLink = React.memo(function InlineLink({
  url,
  onPressIn,
  onPressOut,
}: {
  url: string;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  const foreground = useThemeColor('foreground');
  return (
    <Text
      size={15}
      style={{ color: opacity(foreground, 0.5) }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => Linking.openURL(url).catch(() => {})}>
      {prettifyUrl(url)}
    </Text>
  );
});

// ============================================================================
// Block renderers
// ============================================================================

// ImageBlock is now in ./image-overlay/ImageBlock.tsx — re-exported via the import above.
export { ImageBlock };

const IOSVideoBlock = React.memo(function IOSVideoBlock({
  url,
  onTap,
  onBeforeOpen,
  openOverlay,
  overlayLayout,
}: {
  url: string;
  onTap?: () => void;
  onBeforeOpen?: () => void;
  openOverlay?: (layout: ImageOverlayLayout) => void;
  overlayLayout?: Omit<ImageOverlayLayout, 'pageX' | 'pageY' | 'width' | 'height'>;
}) {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.muted = true;
  });

  const handleTap = useCallback(() => {
    if (openOverlay && overlayLayout && containerRef.current) {
      onBeforeOpen?.();
      containerRef.current.measureInWindow(
        (pageX: number, pageY: number, width: number, height: number) => {
          openOverlay({
            ...overlayLayout,
            pageX,
            pageY,
            width,
            height,
          });
        }
      );
    } else if (onTap) {
      onTap();
    }
  }, [openOverlay, overlayLayout, onBeforeOpen, onTap]);

  const tapGesture = useMemo(
    () =>
      handleTap
        ? Gesture.Tap().onEnd(() => {
            'worklet';
            runOnJS(handleTap)();
          })
        : undefined,
    [handleTap]
  );

  const hasTap = !!(openOverlay && overlayLayout) || !!onTap;
  const aspectRatio = overlayLayout?.aspectRatio ?? 16 / 9;

  const content = (
    <View style={[sharedStyles.videoBlockOuter, { backgroundColor: surface }]}>
      <View
        ref={containerRef}
        collapsable={false}
        style={{ aspectRatio }}
        pointerEvents={hasTap ? 'none' : 'auto'}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={!hasTap}
        />
      </View>
      {hasTap && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Icon name="mingcute:play-fill" size={48} color="rgba(255,255,255,0.75)" />
        </View>
      )}
    </View>
  );

  if (tapGesture) {
    return <GestureDetector gesture={tapGesture}>{content}</GestureDetector>;
  }
  return content;
});

const AndroidVideoBlock = React.memo(function AndroidVideoBlock({
  url,
  onTap,
  onBeforeOpen,
  openOverlay,
  overlayLayout,
}: {
  url: string;
  onTap?: () => void;
  onBeforeOpen?: () => void;
  openOverlay?: (layout: ImageOverlayLayout) => void;
  overlayLayout?: Omit<ImageOverlayLayout, 'pageX' | 'pageY' | 'width' | 'height'>;
}) {
  const [foreground, surface] = useThemeColor(['foreground', 'surface'] as const);
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
  const openInBrowser = useCallback(() => Linking.openURL(url).catch(() => {}), [url]);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.muted = true;
  });

  const handleTap = useCallback(() => {
    if (openOverlay && overlayLayout && containerRef.current) {
      onBeforeOpen?.();
      containerRef.current.measureInWindow(
        (pageX: number, pageY: number, width: number, height: number) => {
          openOverlay({
            ...overlayLayout,
            pageX,
            pageY,
            width,
            height,
          });
        }
      );
    } else {
      (onTap ?? openInBrowser)();
    }
  }, [openOverlay, overlayLayout, onBeforeOpen, onTap, openInBrowser]);

  const tapGesture = useMemo(
    () =>
      Gesture.Tap().onEnd(() => {
        'worklet';
        runOnJS(handleTap)();
      }),
    [handleTap]
  );

  const hasTap = !!(openOverlay && overlayLayout) || !!onTap;
  const aspectRatio = overlayLayout?.aspectRatio ?? 16 / 9;

  const content = (
    <View style={[sharedStyles.videoBlockOuter, { backgroundColor: surface }]}>
      <View
        ref={containerRef}
        collapsable={false}
        style={{ aspectRatio }}
        pointerEvents={hasTap ? 'none' : 'auto'}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          nativeControls={!hasTap}
        />
      </View>
      {hasTap && (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Icon name="mingcute:play-fill" size={48} color="rgba(255,255,255,0.75)" />
        </View>
      )}
    </View>
  );

  return <GestureDetector gesture={tapGesture}>{content}</GestureDetector>;
});

export const VideoBlock = React.memo(function VideoBlock({
  url,
  onTap,
  onBeforeOpen,
  openOverlay,
  overlayLayout,
}: {
  url: string;
  onTap?: () => void;
  onBeforeOpen?: () => void;
  openOverlay?: (layout: ImageOverlayLayout) => void;
  overlayLayout?: Omit<ImageOverlayLayout, 'pageX' | 'pageY' | 'width' | 'height'>;
}) {
  if (Platform.OS === 'android') {
    return (
      <AndroidVideoBlock
        url={url}
        onTap={onTap}
        onBeforeOpen={onBeforeOpen}
        openOverlay={openOverlay}
        overlayLayout={overlayLayout}
      />
    );
  }
  return (
    <IOSVideoBlock
      url={url}
      onTap={onTap}
      onBeforeOpen={onBeforeOpen}
      openOverlay={openOverlay}
      overlayLayout={overlayLayout}
    />
  );
});

export const LightningBlock = React.memo(function LightningBlock({ invoice }: { invoice: string }) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => {
        router.navigate({ pathname: '/(send-flow)/meltQuote' as any, params: { invoice } });
      }}
      style={[sharedStyles.mediaCard, { backgroundColor: surface, borderColor: surfaceTertiary }]}>
      <HStack align="center" gap={8}>
        <Icon name="mingcute:lightning-fill" size={20} color={opacity(foreground, 0.4)} />
        <VStack style={sharedStyles.flex1}>
          <Text bold size={13} style={{ color: opacity(foreground, 0.66) }}>
            Lightning Invoice
          </Text>
          <Text size={11} numberOfLines={1} style={{ color: opacity(foreground, 0.33) }}>
            {invoice.slice(0, 30)}…
          </Text>
        </VStack>
        <Icon name="mdi:chevron-right" size={18} color={opacity(foreground, 0.33)} />
      </HStack>
    </TouchableOpacity>
  );
});

// ============================================================================
// MetricsFooter (superset — includes showBorder + onCommentPress from ThreadView)
// ============================================================================

const AnimatedMetric = React.memo(function AnimatedMetric({
  iconName,
  iconSize,
  text,
  inactiveColor,
  activeColor,
  textSize,
  isActive,
  pending: _pending,
}: {
  iconName: string;
  iconSize: number;
  text: string;
  inactiveColor: string;
  activeColor: string;
  textSize: number;
  isActive: boolean;
  pending: boolean;
}) {
  const color = isActive ? activeColor : inactiveColor;
  return (
    <HStack align="center" gap={5}>
      <Icon name={iconName} size={iconSize} color={color} />
      <Text size={textSize} style={{ color }}>
        {text}
      </Text>
    </HStack>
  );
});

export const MetricsFooter = React.memo(function MetricsFooter({
  metrics,
  borderColor,
  compact = false,
  showBorder = true,
  onCommentPress,
  onRepostPress,
  onLikePress,
  reposted = false,
  liked = false,
  repostPending = false,
  likePending = false,
  repostPendingDirection: _repostPendingDirection,
  likePendingDirection: _likePendingDirection,
  onActionPressIn,
  onActionPressOut,
}: {
  metrics: NoteMetrics;
  borderColor: string;
  compact?: boolean;
  showBorder?: boolean;
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}) {
  const repostedColor = useThemeColor('success');
  const iconColor = opacity(borderColor, 0.57);
  const textColor = opacity(borderColor, 0.57);
  const likedColor = '#ff5a7a';
  const iconSize = compact ? 13 : 16;
  const textSize = compact ? 11 : 13;

  return (
    <View
      style={[
        sharedStyles.noteFooter,
        showBorder && sharedStyles.footerBorder,
        showBorder && { borderBottomColor: opacity(borderColor, 0.1) },
      ]}>
      <HStack align="center" justify="space-between">
        <TouchableOpacity
          activeOpacity={onCommentPress ? 0.7 : 1}
          onPress={onCommentPress}
          disabled={!onCommentPress}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <HStack align="center" gap={5}>
            <Icon name="iconamoon:comment-fill" size={iconSize - 1} color={iconColor} />
            <Text size={textSize} style={{ color: textColor }}>
              {formatCount(metrics.replyCount)}
            </Text>
          </HStack>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={onRepostPress ? 0.7 : 1}
          onPress={onRepostPress}
          disabled={!onRepostPress || repostPending}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="garden:arrow-retweet-fill-16"
            iconSize={iconSize + 1}
            text={formatCount(metrics.repostCount)}
            inactiveColor={textColor}
            activeColor={repostedColor}
            textSize={textSize}
            isActive={reposted}
            pending={repostPending}
          />
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={onLikePress ? 0.7 : 1}
          onPress={onLikePress}
          disabled={!onLikePress || likePending}
          onPressIn={onActionPressIn}
          onPressOut={onActionPressOut}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
          <AnimatedMetric
            iconName="iconamoon:heart-fill"
            iconSize={iconSize}
            text={formatCount(metrics.likeCount)}
            inactiveColor={textColor}
            activeColor={likedColor}
            textSize={textSize}
            isActive={liked}
            pending={likePending}
          />
        </TouchableOpacity>
        {metrics.satsZapped > 0 ? (
          <HStack align="center" gap={4}>
            <Icon name="mingcute:lightning-fill" size={iconSize} color={iconColor} />
            <Text size={textSize} style={{ color: textColor }}>
              {formatSats(metrics.satsZapped)}
            </Text>
          </HStack>
        ) : (
          <Icon name="mingcute:lightning-fill" size={iconSize} color={iconColor} />
        )}
      </HStack>
    </View>
  );
});

// ============================================================================
// QuotedPostCard
// ============================================================================

export const QuotedPostCard = React.memo(function QuotedPostCard({
  event,
  profiles,
  getMetrics,
  onPressIn,
  onPressOut,
}: {
  event: FeedEvent | undefined;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);

  const suppressQuotedTapStart = useCallback(() => {
    onPressIn?.();
  }, [onPressIn]);

  const suppressQuotedTapEnd = useCallback(() => {
    onPressOut?.();
  }, [onPressOut]);

  const handleOpenQuotedThread = useCallback(() => {
    if (!event) return;
    router.navigate({
      pathname: '/(user-flow)/thread' as any,
      params: { eventId: event.id },
    });
  }, [event]);

  if (!event) {
    return (
      <View
        style={[
          sharedStyles.quotedCard,
          { backgroundColor: surface, borderColor: surfaceTertiary },
        ]}>
        <HStack align="center" gap={6}>
          <Icon name="mdi:message-text" size={14} color={opacity(foreground, 0.33)} />
          <Text size={13} italic style={{ color: opacity(foreground, 0.33) }}>
            Quoted post
          </Text>
        </HStack>
      </View>
    );
  }

  const timestamp = event.created_at ? formatTimestamp(event.created_at) : '';
  const profile = profiles.get(event.pubkey);
  const displayName = profile?.name || `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPressIn={suppressQuotedTapStart}
      onPressOut={suppressQuotedTapEnd}
      onPress={handleOpenQuotedThread}>
      <View
        style={[
          sharedStyles.quotedCard,
          { backgroundColor: surface, borderColor: surfaceTertiary },
        ]}>
        <HStack align="center" gap={8} style={sharedStyles.mb6}>
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
            style={{ color: opacity(foreground, 0.66), flex: 1 }}
            numberOfLines={1}>
            {displayName}
          </Text>
          {timestamp ? (
            <>
              <Text bold size={11} style={{ color: opacity(foreground, 0.25), marginRight: 4 }}>
                {'•'}
              </Text>
              <Text size={11} style={{ color: opacity(foreground, 0.33) }}>
                {timestamp}
              </Text>
            </>
          ) : null}
        </HStack>
        <NoteContent
          content={event.content}
          quotedEvents={EMPTY_QUOTED_EVENTS}
          profiles={profiles}
          getMetrics={getMetrics}
          onQuotedPressIn={suppressQuotedTapStart}
          onQuotedPressOut={suppressQuotedTapEnd}
        />
      </View>
    </TouchableOpacity>
  );
});

// ============================================================================
// NoteContent (superset — includes onVideoTap from UserFeed)
// ============================================================================

const CONTENT_TRUNCATE_LIMIT = 280;

function segmentCharCount(seg: ContentSegment): number {
  if (seg.kind === 'text') return seg.text.length;
  if (seg.kind === 'newline') return 1;
  if (seg.kind === 'url') return seg.url.length;
  if (seg.kind === 'hashtag') return seg.tag.length + 1;
  if (seg.kind === 'npub' || seg.kind === 'nprofile') return 12;
  if (seg.kind === 'naddr') return 9;
  return 0;
}

export const NoteContent = React.memo(function NoteContent({
  content,
  quotedEvents,
  profiles,
  getMetrics,
  onVideoTap,
  onQuotedPressIn,
  onQuotedPressOut,
  onInlineActionPressIn,
  onInlineActionPressOut,
  onImagePressIn,
  onImagePressOut,
  event: overlayEvent,
  metrics: overlayMetrics,
  profile: overlayProfile,
  reposted,
  liked,
  repostPending,
  likePending,
  repostPendingDirection,
  likePendingDirection,
  onCommentPress,
  onRepostPress,
  onLikePress,
  onActionPressIn,
  onActionPressOut,
  feedIndex,
  onOverlayOpenedFromIndex,
}: {
  content: string;
  quotedEvents: Map<string, FeedEvent>;
  profiles: Map<string, ProfileInfo>;
  getMetrics: (eventId: string) => NoteMetrics;
  /** Feed list index when in feed; used so swipe-up can scroll to next video post. */
  feedIndex?: number;
  /** Called when overlay is opened from this post. */
  onOverlayOpenedFromIndex?: (index: number) => void;
  onVideoTap?: (url: string) => void;
  onQuotedPressIn?: () => void;
  onQuotedPressOut?: () => void;
  onInlineActionPressIn?: () => void;
  onInlineActionPressOut?: () => void;
  onImagePressIn?: () => void;
  onImagePressOut?: () => void;
  /** Optional: when present, image overlay shows post bottom panel (author, content, stats, reply). */
  event?: FeedEvent;
  metrics?: NoteMetrics;
  profile?: ProfileInfo | null;
  reposted?: boolean;
  liked?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}) {
  const foreground = useThemeColor('foreground');
  const [expanded, setExpanded] = useState(false);
  const imageOverlay = useImageOverlay();

  const onBeforeOpen = useCallback(() => {
    if (typeof feedIndex === 'number' && onOverlayOpenedFromIndex) {
      onOverlayOpenedFromIndex(feedIndex);
    }
  }, [feedIndex, onOverlayOpenedFromIndex]);

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

    while (inline.length > 0 && inline[inline.length - 1].kind === 'newline') {
      inline.pop();
    }

    return { inlineSegments: inline, blockSegments: blocks };
  }, [content]);

  const { mediaSegments, allMediaUrls, allMediaTypes, overlayPost } = useMemo(() => {
    const media = blockSegments.filter(
      (s): s is ContentSegment & { kind: 'image' | 'video'; url: string } =>
        s.kind === 'image' || s.kind === 'video'
    );
    const urls = media.map((s) => s.url);
    const types = media.map((s) => (s.kind === 'video' ? ('video' as const) : ('image' as const)));
    const post: ImageOverlayPost | null =
      overlayEvent && overlayMetrics
        ? {
            event: {
              id: overlayEvent.id,
              pubkey: overlayEvent.pubkey,
              content: overlayEvent.content,
              created_at: overlayEvent.created_at,
            },
            metrics: {
              replyCount: overlayMetrics.replyCount,
              repostCount: overlayMetrics.repostCount,
              likeCount: overlayMetrics.likeCount,
              satsZapped: overlayMetrics.satsZapped,
            },
            profile: overlayProfile ?? null,
            reposted,
            liked,
            repostPending,
            likePending,
            repostPendingDirection,
            likePendingDirection,
            onCommentPress,
            onRepostPress,
            onLikePress,
            onActionPressIn,
            onActionPressOut,
          }
        : null;
    return {
      mediaSegments: media,
      allMediaUrls: urls,
      allMediaTypes: types,
      overlayPost: post,
    };
  }, [
    blockSegments,
    overlayEvent,
    overlayMetrics,
    overlayProfile,
    reposted,
    liked,
    repostPending,
    likePending,
    repostPendingDirection,
    likePendingDirection,
    onCommentPress,
    onRepostPress,
    onLikePress,
    onActionPressIn,
    onActionPressOut,
  ]);

  const { displaySegments, isTruncated, truncatedLastText } = useMemo(() => {
    let total = 0;
    for (const seg of inlineSegments) {
      total += segmentCharCount(seg);
    }
    if (total <= CONTENT_TRUNCATE_LIMIT) {
      return { displaySegments: inlineSegments, isTruncated: false, truncatedLastText: undefined };
    }

    // Build truncated list
    let count = 0;
    const truncated: ContentSegment[] = [];
    let lastText: string | undefined;
    for (const seg of inlineSegments) {
      const len = segmentCharCount(seg);
      if (count + len > CONTENT_TRUNCATE_LIMIT) {
        if (seg.kind === 'text') {
          const remaining = CONTENT_TRUNCATE_LIMIT - count;
          lastText = seg.text.slice(0, remaining);
        }
        break;
      }
      truncated.push(seg);
      count += len;
    }
    return { displaySegments: truncated, isTruncated: true, truncatedLastText: lastText };
  }, [inlineSegments]);

  const hasInline = inlineSegments.length > 0;
  const hasBlocks = blockSegments.length > 0;

  const activeSegments = expanded ? inlineSegments : displaySegments;

  const textColor = { color: opacity(foreground, 0.9) };
  const accentColor = { color: opacity(foreground, 0.5) };

  const renderSegment = (seg: ContentSegment, i: number) => {
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
            onPressIn={onInlineActionPressIn}
            onPressOut={onInlineActionPressOut}
          />
        );
      case 'hashtag':
        return <InlineHashtag key={i} tag={seg.tag} />;
      case 'url':
        return (
          <InlineLink
            key={i}
            url={seg.url}
            onPressIn={onInlineActionPressIn}
            onPressOut={onInlineActionPressOut}
          />
        );
      case 'naddr':
        return (
          <Text key={i} bold size={15} style={accentColor}>
            [article]
          </Text>
        );
      default:
        return null;
    }
  };

  return (
    <VStack gap={0}>
      {hasInline && (
        <Text size={15} style={[textColor, { lineHeight: 22 }]}>
          {activeSegments.map((seg, i) => renderSegment(seg, i))}
          {!expanded && isTruncated && truncatedLastText !== undefined && (
            <React.Fragment key="truncated-tail">{truncatedLastText}</React.Fragment>
          )}
          {!expanded && isTruncated && (
            <Text
              size={15}
              style={accentColor}
              onPressIn={onInlineActionPressIn}
              onPressOut={onInlineActionPressOut}
              onPress={() => setExpanded(true)}>
              {' show more'}
            </Text>
          )}
          {expanded && isTruncated && (
            <Text
              size={15}
              style={accentColor}
              onPressIn={onInlineActionPressIn}
              onPressOut={onInlineActionPressOut}
              onPress={() => setExpanded(false)}>
              {' show less'}
            </Text>
          )}
        </Text>
      )}

      {hasBlocks &&
        (() => {
          const imageUrls = blockSegments
            .filter((s): s is typeof s & { kind: 'image' } => s.kind === 'image')
            .map((s) => s.url);
          return blockSegments.map((seg, i) => {
            switch (seg.kind) {
              case 'image': {
                const imageIndex = imageUrls.indexOf(seg.url);
                const mediaIndex = mediaSegments.findIndex(
                  (m) => m.kind === 'image' && m.url === seg.url
                );
                return (
                  <ImageBlock
                    key={`b${i}`}
                    url={seg.url}
                    allImageUrls={imageUrls.length > 1 ? imageUrls : undefined}
                    imageIndex={imageIndex >= 0 ? imageIndex : 0}
                    allMediaUrls={allMediaUrls.length > 0 ? allMediaUrls : undefined}
                    mediaTypes={allMediaTypes.length > 0 ? allMediaTypes : undefined}
                    mediaIndex={mediaIndex >= 0 ? mediaIndex : undefined}
                    onBeforeOpen={onBeforeOpen}
                    onPressIn={onImagePressIn}
                    onPressOut={onImagePressOut}
                    event={overlayEvent}
                    metrics={overlayMetrics}
                    profile={overlayProfile}
                    reposted={reposted}
                    liked={liked}
                    repostPending={repostPending}
                    likePending={likePending}
                    repostPendingDirection={repostPendingDirection}
                    likePendingDirection={likePendingDirection}
                    onCommentPress={onCommentPress}
                    onRepostPress={onRepostPress}
                    onLikePress={onLikePress}
                    onActionPressIn={onActionPressIn}
                    onActionPressOut={onActionPressOut}
                  />
                );
              }
              case 'video': {
                const mediaIndex = mediaSegments.findIndex(
                  (m) => m.kind === 'video' && m.url === seg.url
                );
                const overlayLayout: Omit<
                  ImageOverlayLayout,
                  'pageX' | 'pageY' | 'width' | 'height'
                > = {
                  url: seg.url,
                  urls: allMediaUrls.length > 0 ? allMediaUrls : undefined,
                  mediaTypes: allMediaTypes.length > 0 ? allMediaTypes : undefined,
                  initialIndex: mediaIndex >= 0 ? mediaIndex : 0,
                  post: overlayPost,
                  aspectRatio: 16 / 9,
                };
                return (
                  <VideoBlock
                    key={`b${i}`}
                    url={seg.url}
                    onBeforeOpen={onBeforeOpen}
                    onTap={
                      !imageOverlay?.open
                        ? onVideoTap
                          ? () => onVideoTap(seg.url)
                          : undefined
                        : undefined
                    }
                    openOverlay={imageOverlay?.open}
                    overlayLayout={imageOverlay?.open && overlayPost ? overlayLayout : undefined}
                  />
                );
              }
              case 'lightning':
                return <LightningBlock key={`b${i}`} invoice={seg.invoice} />;
              case 'nevent':
              case 'note':
                return (
                  <QuotedPostCard
                    key={`b${i}`}
                    event={quotedEvents.get(seg.eventId)}
                    profiles={profiles}
                    getMetrics={getMetrics}
                    onPressIn={onQuotedPressIn}
                    onPressOut={onQuotedPressOut}
                  />
                );
              default:
                return null;
            }
          });
        })()}
    </VStack>
  );
});

// ============================================================================
// Shared Styles
// ============================================================================

export const sharedStyles = StyleSheet.create({
  noteFooter: {},
  footerBorder: {
    borderBottomWidth: 1,
    paddingBottom: 10,
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
  flex1: {
    flex: 1,
  },
  mb4: {
    marginBottom: 4,
  },
  mb6: {
    marginBottom: 6,
  },
  mb10: {
    marginBottom: 10,
  },
});
