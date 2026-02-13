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
 * Uses @nostr-dev-kit/ndk-mobile's useSubscribe hook for real-time subscriptions.
 */

import React, { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { StyleSheet, Animated, Easing, TouchableOpacity, Linking, Dimensions } from 'react-native';
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
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { ShortTextNote, Repost, Reaction, GenericRepost, Metadata } from 'nostr-tools/kinds';
import { nip19 } from 'nostr-tools';
import type { NDKEvent } from '@nostr-dev-kit/ndk-mobile';

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

/** Profile info stored for both inline mentions and quoted post authors */
interface ProfileInfo {
  name: string;
  picture?: string;
}

/** Unified feed item — either an original note or a repost (Kind 6/16) */
type FeedItem =
  | { type: 'note'; event: NDKEvent; timestamp: number }
  | {
      type: 'repost';
      repostEvent: NDKEvent;
      originalEvent: NDKEvent | undefined;
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

// Stable subscription option objects (module-level = referentially stable,
// won't trigger useSubscribe's useEffect re-runs)

/** One-shot fetch: close after initial relay load. Good for ID lookups & profiles. */
const CLOSE_ON_EOSE_OPTS = { closeOnEose: true } as const;

/** Metrics: skip expensive ed25519 sig checks (we only count), buffer aggressively */
const METRICS_SUB_OPTS = { skipVerification: true, bufferMs: 150 } as const;

/** Shared empty map — used by QuotedPostCard / RepostCard to prevent quote recursion */
const EMPTY_QUOTED_EVENTS: Map<string, NDKEvent> = new Map();
/** Shared default for cache misses so we don't allocate a new object every call */
const DEFAULT_METRICS: NoteMetrics = Object.freeze({ likeCount: 0, repostCount: 0, replyCount: 0 });

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
function collectReferencedIds(notes: NDKEvent[]): {
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

function isRootNote(event: NDKEvent): boolean {
  const eTags = (event.tags || []).filter((t) => t[0] === 'e');
  if (eTags.length === 0) return true;
  return eTags.every((t) => t[3] === 'mention');
}

function tryNpubEncode(hex: string): string {
  try {
    return nip19.npubEncode(hex);
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
      style={{ color: getPrimaryColor('300') }}
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
    <Text bold size={15} style={{ color: getPrimaryColor('300') }}>
      #{tag}
    </Text>
  );
});

const InlineLink = React.memo(function InlineLink({ url }: { url: string }) {
  const { getPrimaryColor } = useTheme();
  return (
    <Text
      size={15}
      style={{ color: getPrimaryColor('300') }}
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

/** Inline video player using expo-video */
const VideoBlock = React.memo(function VideoBlock({ url }: { url: string }) {
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
        <Icon name="mingcute:lightning-fill" size={20} color={getPrimaryColor('400')} />
        <VStack style={styles.flex1}>
          <Text bold size={13} style={{ color: getPrimaryColor('200') }}>
            Lightning Invoice
          </Text>
          <Text size={11} numberOfLines={1} style={{ color: getPrimaryColor('500') }}>
            {invoice.slice(0, 30)}…
          </Text>
        </VStack>
        <Icon name="mdi:chevron-right" size={18} color={getPrimaryColor('500')} />
      </HStack>
    </TouchableOpacity>
  );
});

// ============================================================================
// QuotedPostCard — inline preview of a referenced event with author avatar
// ============================================================================

const QuotedPostCard = React.memo(function QuotedPostCard({
  event,
  profiles,
}: {
  event: NDKEvent | undefined;
  profiles: Map<string, ProfileInfo>;
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
          <Icon name="mdi:message-text" size={14} color={getPrimaryColor('500')} />
          <Text size={13} italic style={{ color: getPrimaryColor('500') }}>
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
          <Text bold size={13} style={{ color: getPrimaryColor('200'), flex: 1 }} numberOfLines={1}>
            {displayName}
          </Text>
          {timestamp ? (
            <Text size={11} semibold style={{ color: getPrimaryColor('500') }}>
              {timestamp}
            </Text>
          ) : null}
        </HStack>
        {/* Body — full rich rendering (images, links, etc.) but no nested quotes */}
        <NoteContent
          content={event.content}
          quotedEvents={EMPTY_QUOTED_EVENTS}
          profiles={profiles}
        />
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
}: {
  content: string;
  quotedEvents: Map<string, NDKEvent>;
  profiles: Map<string, ProfileInfo>;
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
        <Text size={15} style={{ color: getPrimaryColor('50'), lineHeight: 22 }}>
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
                  <Text key={i} bold size={15} style={{ color: getPrimaryColor('300') }}>
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
                  profiles={profiles}
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
  authorName,
  authorPicture,
  authorPubkey,
}: {
  event: NDKEvent;
  metrics: NoteMetrics;
  index: number;
  quotedEvents: Map<string, NDKEvent>;
  profiles: Map<string, ProfileInfo>;
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
          <Text bold size={14} style={{ color: getPrimaryColor('50') }}>
            {authorName}
          </Text>
        </VStack>
        <Text semibold size={13} style={{ color: getPrimaryColor('400') }}>
          {timestamp}
        </Text>
      </HStack>

      {/* Content */}
      <NoteContent content={event.content} quotedEvents={quotedEvents} profiles={profiles} />

      <Spacer size={12} />

      {/* Footer: Engagement metrics — equally spaced across full width */}
      <View
        style={[
          styles.noteFooter,
          styles.footerBorder,
          { borderTopColor: getPrimaryColor('700') },
        ]}>
        <HStack align="center">
          {/* Replies */}
          <View style={styles.metricItem}>
            <HStack align="center" gap={5} style={styles.metricRow}>
              <Icon
                name="garden:speech-bubble-typing-fill-12"
                size={15}
                color={getPrimaryColor('400')}
              />
              <Text size={13} style={{ color: getPrimaryColor('400') }}>
                {formatCount(metrics.replyCount)}
              </Text>
            </HStack>
          </View>

          {/* Reposts */}
          <View style={styles.metricItem}>
            <HStack align="center" gap={5} style={styles.metricRow}>
              <Icon name="garden:arrow-retweet-fill-16" size={17} color={getPrimaryColor('400')} />
              <Text size={13} style={{ color: getPrimaryColor('400') }}>
                {formatCount(metrics.repostCount)}
              </Text>
            </HStack>
          </View>

          {/* Likes */}
          <View style={styles.metricItem}>
            <HStack align="center" gap={5} style={styles.metricRow}>
              <Icon name="garden:heart-fill-16" size={16} color={getPrimaryColor('400')} />
              <Text size={13} style={{ color: getPrimaryColor('400') }}>
                {formatCount(metrics.likeCount)}
              </Text>
            </HStack>
          </View>
        </HStack>
      </View>
    </Animated.View>
  );
});

// ============================================================================
// Repost Card — wraps the original post with a "reposted by" header
// ============================================================================

const RepostCard = React.memo(function RepostCard({
  repostEvent: _repostEvent,
  originalEvent,
  index,
  quotedEvents: _quotedEvents,
  profiles,
  reposterName,
  reposterPubkey,
}: {
  repostEvent: NDKEvent;
  originalEvent: NDKEvent | undefined;
  index: number;
  quotedEvents: Map<string, NDKEvent>;
  profiles: Map<string, ProfileInfo>;
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
          <Icon name="garden:arrow-retweet-fill-16" size={14} color={getPrimaryColor('500')} />
          <Text size={12} semibold style={{ color: getPrimaryColor('500') }}>
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
              <Text bold size={14} style={{ color: getPrimaryColor('50') }}>
                {originalName}
              </Text>
            </VStack>
            <Text semibold size={13} style={{ color: getPrimaryColor('400') }}>
              {originalTimestamp}
            </Text>
          </HStack>

          {/* Original post body — full rich rendering, no nested quote recursion */}
          <NoteContent
            content={originalEvent.content}
            quotedEvents={EMPTY_QUOTED_EVENTS}
            profiles={profiles}
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
            <Icon name="mdi:message-text" size={14} color={getPrimaryColor('500')} />
            <Text size={13} italic style={{ color: getPrimaryColor('500') }}>
              Original post unavailable
            </Text>
          </HStack>
        </View>
      )}
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
      <Text bold size={16} style={{ color: getPrimaryColor('300') }}>
        No posts yet
      </Text>
      <Spacer size={4} />
      <Text size={13} style={[styles.textAlignCenter, { color: getPrimaryColor('500') }]}>
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

  // ---------------------------
  // 1. Subscribe to ALL user content (Kind 1 + 6 + 16) in ONE relay REQ
  // ---------------------------
  const userContentFilters = useMemo(
    () =>
      pubkey
        ? [
            {
              kinds: [ShortTextNote as number, Repost as number, GenericRepost as number],
              authors: [pubkey],
              limit: 50,
            },
          ]
        : null,
    [pubkey]
  );
  const { events: userContentEvents, eose: contentEose } = useSubscribe({
    filters: userContentFilters,
  });

  // Split client-side: root notes vs reposts
  const { rootNotes, userRepostEvents } = useMemo(() => {
    if (!userContentEvents?.length)
      return { rootNotes: [] as NDKEvent[], userRepostEvents: [] as NDKEvent[] };
    const notes: NDKEvent[] = [];
    const reposts: NDKEvent[] = [];
    for (const ev of userContentEvents) {
      if (ev.kind === ShortTextNote) {
        if (isRootNote(ev)) notes.push(ev);
      } else {
        reposts.push(ev);
      }
    }
    return { rootNotes: notes, userRepostEvents: reposts };
  }, [userContentEvents]);

  // Extract original event IDs from repost e-tags
  const repostedEventIds = useMemo(() => {
    if (!userRepostEvents?.length) return [];
    const ids: string[] = [];
    for (const ev of userRepostEvents) {
      const eTag = ev.tags?.find((t) => t[0] === 'e');
      if (eTag?.[1]) ids.push(eTag[1]);
    }
    return ids;
  }, [userRepostEvents]);

  // Fetch original events that were reposted
  const repostedEventsFilter = useMemo(
    () => (repostedEventIds.length > 0 ? [{ ids: repostedEventIds }] : null),
    [repostedEventIds]
  );
  const { events: repostedEventsList } = useSubscribe({
    filters: repostedEventsFilter,
    opts: CLOSE_ON_EOSE_OPTS,
  });

  const repostedEventsMap = useMemo(() => {
    const map = new Map<string, NDKEvent>();
    repostedEventsList?.forEach((ev) => map.set(ev.id, ev));
    return map;
  }, [repostedEventsList]);

  // ---------------------------
  // 2. Build unified timeline (notes + reposts sorted by time)
  // ---------------------------
  const feedItems: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [];

    // Original notes
    for (const event of rootNotes) {
      items.push({ type: 'note', event, timestamp: event.created_at || 0 });
    }

    // Reposts
    if (userRepostEvents?.length) {
      for (const repostEvent of userRepostEvents) {
        const eTag = repostEvent.tags?.find((t) => t[0] === 'e');
        if (eTag?.[1]) {
          items.push({
            type: 'repost',
            repostEvent,
            originalEvent: repostedEventsMap.get(eTag[1]),
            originalEventId: eTag[1],
            timestamp: repostEvent.created_at || 0,
          });
        }
      }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }, [rootNotes, userRepostEvents, repostedEventsMap]);

  // ---------------------------
  // 3. Subscribe to engagement metrics for all visible events
  // ---------------------------
  // Combine the user's own note IDs + original reposted event IDs
  const allEventIdsForMetrics = useMemo(() => {
    const set = new Set<string>();
    for (const n of rootNotes) set.add(n.id);
    for (const id of repostedEventIds) set.add(id);
    return Array.from(set);
  }, [rootNotes, repostedEventIds]);

  // Single combined metrics subscription: reactions + reposts + replies in ONE relay REQ
  // (skipVerification: we only count events, don't need sig checks;
  //  bufferMs: 150 to batch rapid-fire metric events into fewer re-renders)
  const metricsFilters = useMemo(
    () =>
      allEventIdsForMetrics.length > 0
        ? [
            {
              kinds: [
                Reaction as number,
                Repost as number,
                GenericRepost as number,
                ShortTextNote as number,
              ],
              '#e': allEventIdsForMetrics,
            },
          ]
        : null,
    [allEventIdsForMetrics]
  );
  const { events: metricsEvents } = useSubscribe({
    filters: metricsFilters,
    opts: METRICS_SUB_OPTS,
  });

  const metricsMap = useMemo(() => {
    const map = new Map<string, NoteMetrics>();
    for (const id of allEventIdsForMetrics)
      map.set(id, { likeCount: 0, repostCount: 0, replyCount: 0 });

    metricsEvents?.forEach((ev) => {
      const eTag = ev.tags?.find((t) => t[0] === 'e');
      if (!eTag) return;
      const m = map.get(eTag[1]);
      if (!m) return;

      if (ev.kind === Reaction) {
        if (ev.content === '+' || ev.content === '') m.likeCount++;
      } else if (ev.kind === Repost || ev.kind === GenericRepost) {
        m.repostCount++;
      } else if (ev.kind === ShortTextNote) {
        m.replyCount++;
      }
    });

    return map;
  }, [allEventIdsForMetrics, metricsEvents]);

  const getMetrics = useCallback(
    (noteId: string): NoteMetrics => metricsMap.get(noteId) || DEFAULT_METRICS,
    [metricsMap]
  );

  // ---------------------------
  // 4. Resolve nostr: entities in content
  // ---------------------------
  // Collect references from the user's own notes AND the reposted originals
  const { eventIds: referencedEventIds, pubkeys: inlineMentionPubkeys } = useMemo(() => {
    const allContent: NDKEvent[] = [...rootNotes];
    repostedEventsList?.forEach((ev) => allContent.push(ev));
    return collectReferencedIds(allContent);
  }, [rootNotes, repostedEventsList]);

  // Quoted events (Kind 1) referenced inside content
  const quotedEventsFilter = useMemo(
    () =>
      referencedEventIds.length > 0
        ? [{ ids: referencedEventIds, kinds: [ShortTextNote as number] }]
        : null,
    [referencedEventIds]
  );
  const { events: quotedEventsList } = useSubscribe({
    filters: quotedEventsFilter,
    opts: CLOSE_ON_EOSE_OPTS,
  });

  const quotedEventsMap = useMemo(() => {
    const map = new Map<string, NDKEvent>();
    quotedEventsList?.forEach((ev) => map.set(ev.id, ev));
    return map;
  }, [quotedEventsList]);

  // Merge ALL pubkeys that need profile data:
  // inline mentions + quoted event authors + reposted event authors
  const allProfilePubkeys = useMemo(() => {
    const set = new Set(inlineMentionPubkeys);
    quotedEventsList?.forEach((ev) => set.add(ev.pubkey));
    repostedEventsList?.forEach((ev) => set.add(ev.pubkey));
    return Array.from(set);
  }, [inlineMentionPubkeys, quotedEventsList, repostedEventsList]);

  // Profile metadata (Kind 0)
  const profilesFilter = useMemo(
    () =>
      allProfilePubkeys.length > 0
        ? [
            {
              authors: allProfilePubkeys,
              kinds: [Metadata as number],
              limit: allProfilePubkeys.length,
            },
          ]
        : null,
    [allProfilePubkeys]
  );
  const { events: profileMetadataEvents } = useSubscribe({
    filters: profilesFilter,
    opts: CLOSE_ON_EOSE_OPTS,
  });

  const profilesMap = useMemo(() => {
    const map = new Map<string, ProfileInfo>();
    profileMetadataEvents?.forEach((ev) => {
      try {
        const meta = JSON.parse(ev.content);
        const name = meta.display_name || meta.name;
        if (name) map.set(ev.pubkey, { name, picture: meta.picture });
      } catch {
        // skip malformed metadata
      }
    });
    return map;
  }, [profileMetadataEvents]);

  // ---------------------------
  // Render
  // ---------------------------
  const isLoading = !contentEose;
  const displayName = authorName || tryNpubEncode(pubkey).slice(0, 12) + '…';

  return (
    <View style={styles.feedContainer}>
      {/* Section title — styled the same as "Profile Info" (Section component) */}
      <Text
        medium
        overpass
        size={13}
        style={[styles.sectionTitle, { color: getPrimaryColor('300') }]}>
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
                index={index}
                quotedEvents={quotedEventsMap}
                profiles={profilesMap}
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
