import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Platform, type LayoutChangeEvent } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useVideoPlayer, VideoView } from 'expo-video';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';
import { log, feedLog } from '@/shared/lib/logger';
import {
  useShiftLogger,
  useVisualLayoutLogger,
  VISUAL_LOGGING_ENABLED,
} from '@/shared/lib/contentShiftLog';
import { openExternalUrl } from '@/shared/lib/url';
import { staticPopup } from '@/shared/lib/popup';
import { ImageBlock, useImageOverlay } from './image-overlay';
import type { ImageOverlayLayout, ImageOverlayPost } from './image-overlay';
import { decodeBolt11Invoice } from 'wallet';
import { usePaymentFlowMachine } from 'wallet/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ContentSegment, FeedEvent, NoteMetrics, ProfileInfo } from './feedTypes';
import {
  collectQuoteTagIds,
  mediaKindForMime,
  parseContent,
  parseImetaTags,
  prettifyUrl,
  tryNpubEncode,
} from './feedParse';
import { PollCard } from './poll/PollCard';
import { RelayCard } from './RelayCard';
import { POLL_KIND } from './poll/pollParse';
import { formatRelativeUnixSeconds } from '@/shared/lib/date';
import { sharedStyles } from './feedStyles';
import { fontSize } from '@/shared/styles/tokens';
import { NOTE_CONTENT_LINE_HEIGHT } from '@/features/feed/lib/threadListLayout';
import { clearPaymentContext } from '@/shared/stores/runtime/clearPaymentContext';

// Re-exported so `NoteContent` stays the import site for note-rendering
// consumers (PostCard); the value's source of truth lives in `threadListLayout`
// so the rendered line height and the skeleton fixed-size math can't drift.
export { NOTE_CONTENT_LINE_HEIGHT };

const EMPTY_QUOTED_EVENTS: Map<string, FeedEvent> = new Map();
export const NOTE_CONTENT_FONT_SIZE = fontSize.lg;

// ─── Inline renderers ────────────────────────────────────────────────────────

const InlineMention = React.memo(function InlineMention({
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
      size={NOTE_CONTENT_FONT_SIZE}
      style={{ color: withAlpha(foreground, 0.5) }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => {
        router.push({ pathname: '/(user-flow)/profile', params: { pubkey } });
      }}>
      @{label}
    </Text>
  );
});

const InlineHashtag = React.memo(function InlineHashtag({ tag }: { tag: string }) {
  const foreground = useThemeColor('foreground');
  return (
    <Text bold size={NOTE_CONTENT_FONT_SIZE} style={{ color: withAlpha(foreground, 0.5) }}>
      #{tag}
    </Text>
  );
});

const InlineLink = React.memo(function InlineLink({
  url,
  onActivate,
  onPressIn,
  onPressOut,
}: {
  url: string;
  /** When provided, handles the tap instead of opening the OS browser (used to
   *  embed the link in-thread). */
  onActivate?: (url: string) => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  const foreground = useThemeColor('foreground');
  return (
    <Text
      size={NOTE_CONTENT_FONT_SIZE}
      style={{ color: withAlpha(foreground, 0.5) }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={async () => {
        if (onActivate) {
          onActivate(url);
          return;
        }
        const result = await openExternalUrl(url);
        if (result.isErr()) {
          log.warn('feed.inline_link.open_failed', { reason: result.error.type });
          staticPopup('open-link-failed');
        }
      }}>
      {prettifyUrl(url)}
    </Text>
  );
});

// ─── Block renderers ─────────────────────────────────────────────────────────

/** Relay cards past this ordinal render without fetching NIP-11. */
const RELAY_NIP11_FETCH_CAP = 3;

/**
 * Tap handling for an inline video block: measure the thumbnail and hand its
 * rect to the overlay, or fall back to the caller's tap / the OS browser.
 *
 * The container ref lives in here because the gesture's `onEnd` closes over it
 * and is handed to `Gesture.Tap()` during render — which React Compiler reads
 * as a render-time ref access, and a note body is on the feed's hot path.
 */
function useVideoTapGesture({
  isAndroid,
  onBeforeOpen,
  onTap,
  openInBrowser,
  openOverlay,
  overlayLayout,
}: {
  isAndroid: boolean;
  onBeforeOpen?: () => void;
  onTap?: () => void;
  openInBrowser: () => void | Promise<void>;
  openOverlay?: (layout: ImageOverlayLayout) => void;
  overlayLayout?: Omit<ImageOverlayLayout, 'pageX' | 'pageY' | 'width' | 'height'>;
}) {
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);

  const handleTap = useCallback(() => {
    if (openOverlay && overlayLayout && containerRef.current) {
      onBeforeOpen?.();
      containerRef.current.measureInWindow(
        (pageX: number, pageY: number, width: number, height: number) => {
          openOverlay({ ...overlayLayout, pageX, pageY, width, height });
        }
      );
    } else if (isAndroid) {
      void (onTap ?? openInBrowser)();
    } else if (onTap) {
      onTap();
    }
  }, [openOverlay, overlayLayout, onBeforeOpen, onTap, isAndroid, openInBrowser]);

  const tapGesture = useMemo(() => {
    if (!isAndroid && !handleTap) return undefined;
    return Gesture.Tap().onEnd(() => {
      'worklet';
      runOnJS(handleTap)();
    });
  }, [isAndroid, handleTap]);

  return { containerRef, tapGesture };
}

const VideoBlockInner = React.memo(function VideoBlockInner({
  url,
  onTap,
  onBeforeOpen,
  openOverlay,
  overlayLayout,
  aspectRatio: aspectRatioProp,
}: {
  url: string;
  onTap?: () => void;
  onBeforeOpen?: () => void;
  openOverlay?: (layout: ImageOverlayLayout) => void;
  overlayLayout?: Omit<ImageOverlayLayout, 'pageX' | 'pageY' | 'width' | 'height'>;
  /** NIP-92 imeta-derived aspect ratio for the inline player (overlay wins if present). */
  aspectRatio?: number;
}) {
  const surface = useThemeColor('surface');
  const isAndroid = Platform.OS === 'android';
  const openInBrowser = useCallback(async () => {
    const result = await openExternalUrl(url);
    if (result.isErr()) {
      log.warn('feed.video.open_failed', { reason: result.error.type });
      staticPopup('open-link-failed');
    }
  }, [url]);
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.muted = true;
  });

  const { containerRef, tapGesture } = useVideoTapGesture({
    isAndroid,
    onBeforeOpen,
    onTap,
    openInBrowser,
    openOverlay,
    overlayLayout,
  });

  const hasTap = !!(openOverlay && overlayLayout) || !!onTap;
  const aspectRatio = overlayLayout?.aspectRatio ?? aspectRatioProp ?? 16 / 9;

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
      {hasTap ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
          <Icon name="mingcute:play-fill" size={48} color="rgba(255,255,255,0.75)" />
        </View>
      ) : null}
    </View>
  );

  if (tapGesture) {
    return <GestureDetector gesture={tapGesture}>{content}</GestureDetector>;
  }
  return content;
});

const VideoBlock = VideoBlockInner;

const LightningBlock = React.memo(function LightningBlock({ meltTarget }: { meltTarget: string }) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  // Decode the bolt11 once at memo time through colada's canonical decoder —
  // the same one the payment machine seeds its amount from, so the chip can
  // never advertise a different number than the flow charges. A meltTarget
  // that fails decoding renders as a non-tappable "Invalid Lightning invoice"
  // chip, so a relay-supplied lnbc-shaped string never reaches
  // `machine.execute`.
  const decoded = useMemo(() => decodeBolt11Invoice(meltTarget), [meltTarget]);

  if (!decoded) {
    return (
      <View
        style={[
          sharedStyles.mediaCard,
          { backgroundColor: surface, borderColor: surfaceTertiary },
        ]}>
        <HStack align="center" gap={8}>
          <Icon name="mingcute:lightning-fill" size={20} color={withAlpha(foreground, 0.2)} />
          <VStack style={sharedStyles.flex1}>
            <Text bold size={13} style={{ color: withAlpha(foreground, 0.4) }}>
              Invalid Lightning invoice
            </Text>
            <Text size={11} numberOfLines={1} style={{ color: withAlpha(foreground, 0.25) }}>
              {meltTarget.slice(0, 30)}…
            </Text>
          </VStack>
        </HStack>
      </View>
    );
  }

  const subtitle =
    decoded.amountSat !== null
      ? `${decoded.amountSat.toLocaleString()} sats`
      : `${meltTarget.slice(0, 30)}…`;

  return (
    <Pressable
      onPress={() => {
        clearPaymentContext('feed.lightning_invoice');
        void machine.execute(meltTarget, { reset: true });
      }}
      style={[sharedStyles.mediaCard, { backgroundColor: surface, borderColor: surfaceTertiary }]}>
      <HStack align="center" gap={8}>
        <Icon name="mingcute:lightning-fill" size={20} color={withAlpha(foreground, 0.4)} />
        <VStack style={sharedStyles.flex1}>
          <Text bold size={13} style={{ color: withAlpha(foreground, 0.66) }}>
            Lightning Invoice
          </Text>
          <Text size={11} numberOfLines={1} style={{ color: withAlpha(foreground, 0.33) }}>
            {subtitle}
          </Text>
        </VStack>
        <Icon name="mdi:chevron-right" size={18} color={withAlpha(foreground, 0.33)} />
      </HStack>
    </Pressable>
  );
});

// ─── QuotedPostCard ──────────────────────────────────────────────────────────

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
      pathname: '/(user-flow)/thread',
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
          <Icon name="mdi:message-text" size={14} color={withAlpha(foreground, 0.33)} />
          <Text size={13} italic style={{ color: withAlpha(foreground, 0.33) }}>
            Quoted post
          </Text>
        </HStack>
      </View>
    );
  }

  const timestamp = formatRelativeUnixSeconds(event.created_at);
  const profile = profiles.get(event.pubkey);
  const displayName = profile?.name || `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;

  return (
    <Pressable
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
            state={profile?.picture ? 'image' : 'fallback'}
            picture={profile?.picture}
            seed={event.pubkey}
            size={24}
            name={displayName}
          />
          <Text
            bold
            size={13}
            style={{ color: withAlpha(foreground, 0.66), flex: 1 }}
            numberOfLines={1}>
            {displayName}
          </Text>
          {timestamp ? (
            <>
              <Text bold size={11} style={{ color: withAlpha(foreground, 0.25), marginRight: 4 }}>
                {'•'}
              </Text>
              <Text size={11} style={{ color: withAlpha(foreground, 0.33) }}>
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
    </Pressable>
  );
});

// ─── NoteContent ─────────────────────────────────────────────────────────────

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
  onLinkPress,
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
  replied,
  zapped,
  repostPending,
  likePending,
  zapPending,
  repostPendingDirection,
  likePendingDirection,
  onCommentPress,
  onRepostPress,
  onLikePress,
  onZapPress,
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
  /** When set, tapping an inline link calls this (to embed it in-thread)
   *  instead of opening the OS browser. */
  onLinkPress?: (url: string) => void;
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
  replied?: boolean;
  zapped?: boolean;
  repostPending?: boolean;
  likePending?: boolean;
  zapPending?: boolean;
  repostPendingDirection?: 'activating' | 'deactivating';
  likePendingDirection?: 'activating' | 'deactivating';
  onCommentPress?: () => void;
  onRepostPress?: () => void;
  onLikePress?: () => void;
  onZapPress?: () => void;
  onActionPressIn?: () => void;
  onActionPressOut?: () => void;
}) {
  const foreground = useThemeColor('foreground');
  const [expanded, setExpanded] = useState(false);
  const imageOverlay = useImageOverlay();
  const shift = useShiftLogger('NoteContent');
  const noteKey = overlayEvent?.id ?? 'inline-note';

  const toggleExpanded = useCallback(
    (next: boolean) => {
      feedLog.info('feed.shift.note.expand', {
        component: 'NoteContent',
        key: noteKey,
        expanded: next,
        contentLength: content.length,
      });
      setExpanded(next);
    },
    [noteKey, content.length]
  );

  const onBeforeOpen = useCallback(() => {
    if (typeof feedIndex === 'number' && onOverlayOpenedFromIndex) {
      onOverlayOpenedFromIndex(feedIndex);
    }
  }, [feedIndex, onOverlayOpenedFromIndex]);

  // NIP-92 imeta metadata (mime / alt / dimensions / blurhash) keyed by media url.
  const imetaByUrl = useMemo(() => parseImetaTags(overlayEvent?.tags ?? []), [overlayEvent]);

  const { inlineSegments, blockSegments } = useMemo(() => {
    const segments = parseContent(content);
    const inline: ContentSegment[] = [];
    const blocks: ContentSegment[] = [];

    for (const seg of segments) {
      // A url the parser couldn't classify by extension may still be media if an
      // imeta tag declares its mime (e.g. an extensionless Blossom blob).
      let resolved: ContentSegment = seg;
      if (seg.kind === 'url') {
        const kind = mediaKindForMime(imetaByUrl.get(seg.url)?.mimeType);
        if (kind === 'image') resolved = { kind: 'image', url: seg.url };
        else if (kind === 'video') resolved = { kind: 'video', url: seg.url };
      }
      switch (resolved.kind) {
        case 'image':
        case 'video':
        case 'lightning':
        case 'relay':
        case 'nevent':
        case 'note':
          blocks.push(resolved);
          break;
        default:
          inline.push(resolved);
      }
    }

    while (inline.length > 0 && inline[inline.length - 1].kind === 'newline') {
      inline.pop();
    }

    return { inlineSegments: inline, blockSegments: blocks };
  }, [content, imetaByUrl]);

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
              kind: overlayEvent.kind,
              pubkey: overlayEvent.pubkey,
              content: overlayEvent.content,
              tags: overlayEvent.tags,
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
            replied,
            zapped,
            repostPending,
            likePending,
            zapPending,
            repostPendingDirection,
            likePendingDirection,
            onCommentPress,
            onRepostPress,
            onLikePress,
            onZapPress,
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
    replied,
    zapped,
    repostPending,
    likePending,
    zapPending,
    repostPendingDirection,
    likePendingDirection,
    onCommentPress,
    onRepostPress,
    onLikePress,
    onZapPress,
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
  const { ref: attachVisualLayoutNode, onLayout: reportVisualLayout } = useVisualLayoutLogger({
    scope: `feed.note.${noteKey.slice(0, 12)}`,
    surface: 'feed',
    component: 'NoteContent',
    itemKey: noteKey,
    itemType: overlayEvent ? `kind-${overlayEvent.kind}` : 'inline',
    extra: () => ({
      contentLength: content.length,
      blockCount: blockSegments.length,
      expanded,
      truncated: isTruncated,
    }),
  });

  // Body height after layout. Re-fires when async data (a mention name
  // resolving, a quoted event arriving, an image settling its aspect ratio)
  // reflows the note — the raw signal for "the post grew/shrank under me".
  const handleNoteLayout = useCallback(
    (e: LayoutChangeEvent) => {
      reportVisualLayout?.(e);
      shift.report('feed.shift.note.height', noteKey, e.nativeEvent.layout.height, {
        contentLength: content.length,
        blockCount: blockSegments.length,
        expanded,
      });
    },
    [reportVisualLayout, shift, noteKey, content.length, blockSegments.length, expanded]
  );
  // Purely instrumentation: in a release build both reporters are inert, and an
  // attached handler would still cost a native layout dispatch per note.
  const noteLayoutHandler = VISUAL_LOGGING_ENABLED ? handleNoteLayout : undefined;
  const taggedQuoteIds = useMemo(() => {
    if (!overlayEvent) return [];
    const inlineQuoteIds = new Set(
      blockSegments
        .filter((seg) => seg.kind === 'nevent' || seg.kind === 'note')
        .map((seg) => (seg.kind === 'nevent' || seg.kind === 'note' ? seg.eventId : ''))
    );
    return collectQuoteTagIds(overlayEvent).filter((id) => !inlineQuoteIds.has(id));
  }, [blockSegments, overlayEvent]);

  const activeSegments = expanded ? inlineSegments : displaySegments;

  const textColor = { color: withAlpha(foreground, 0.9) };
  const accentColor = { color: withAlpha(foreground, 0.5) };

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
            onActivate={onLinkPress}
            onPressIn={onInlineActionPressIn}
            onPressOut={onInlineActionPressOut}
          />
        );
      case 'naddr':
        return (
          <Text key={i} bold size={NOTE_CONTENT_FONT_SIZE} style={accentColor}>
            [article]
          </Text>
        );
      default:
        return null;
    }
  };

  const renderQuoteCard = (eventId: string, key: string) => (
    <QuotedPostCard
      key={key}
      event={quotedEvents.get(eventId)}
      profiles={profiles}
      getMetrics={getMetrics}
      onPressIn={onQuotedPressIn}
      onPressOut={onQuotedPressOut}
    />
  );

  const renderQuoteBlockSegment = (seg: ContentSegment, i: number) => {
    if (seg.kind !== 'nevent' && seg.kind !== 'note') return null;
    return renderQuoteCard(seg.eventId, `b${i}`);
  };

  // A NIP-88 poll (kind:1068) renders the poll card in place of text content,
  // while quote cards remain below it when the poll cites another post.
  if (overlayEvent?.kind === POLL_KIND) {
    return (
      <VStack ref={attachVisualLayoutNode} gap={0} onLayout={noteLayoutHandler}>
        <PollCard event={overlayEvent} />
        {blockSegments.map((seg, i) => renderQuoteBlockSegment(seg, i))}
        {taggedQuoteIds.map((id) => renderQuoteCard(id, `q${id}`))}
      </VStack>
    );
  }

  return (
    <VStack ref={attachVisualLayoutNode} gap={0} onLayout={noteLayoutHandler}>
      {hasInline && (
        <Text
          size={NOTE_CONTENT_FONT_SIZE}
          style={[textColor, { lineHeight: NOTE_CONTENT_LINE_HEIGHT }]}>
          {activeSegments.map((seg, i) => renderSegment(seg, i))}
          {!expanded && isTruncated && truncatedLastText !== undefined && (
            <React.Fragment key="truncated-tail">{truncatedLastText}</React.Fragment>
          )}
          {!expanded && isTruncated && (
            <Text
              size={NOTE_CONTENT_FONT_SIZE}
              style={accentColor}
              onPressIn={onInlineActionPressIn}
              onPressOut={onInlineActionPressOut}
              onPress={() => toggleExpanded(true)}>
              {' show more'}
            </Text>
          )}
          {expanded && isTruncated && (
            <Text
              size={NOTE_CONTENT_FONT_SIZE}
              style={accentColor}
              onPressIn={onInlineActionPressIn}
              onPressOut={onInlineActionPressOut}
              onPress={() => toggleExpanded(false)}>
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
          // Fan-out cap: only the first few relay cards per note fetch NIP-11
          // (a pasted NIP-65-style relay dump must not fan out N HTTP GETs);
          // the rest render the static non-fetching row. Resolved up front —
          // counting inside the map's callback mutates a captured variable,
          // which React Compiler cannot lower.
          const relayOrdinalBySegment = new Map<number, number>();
          for (let index = 0, seen = 0; index < blockSegments.length; index += 1) {
            if (blockSegments[index].kind === 'relay') {
              relayOrdinalBySegment.set(index, seen);
              seen += 1;
            }
          }
          return blockSegments.map((seg, i) => {
            switch (seg.kind) {
              case 'image': {
                const imageIndex = imageUrls.indexOf(seg.url);
                const mediaIndex = mediaSegments.findIndex(
                  (m) => m.kind === 'image' && m.url === seg.url
                );
                const imageImeta = imetaByUrl.get(seg.url);
                const imetaAspect =
                  imageImeta?.width && imageImeta?.height
                    ? imageImeta.width / imageImeta.height
                    : undefined;
                return (
                  <ImageBlock
                    key={`b${i}`}
                    url={seg.url}
                    alt={imageImeta?.alt}
                    blurhash={imageImeta?.blurhash}
                    initialAspectRatio={imetaAspect}
                    allImageUrls={imageUrls.length > 1 ? imageUrls : undefined}
                    imageIndex={imageIndex >= 0 ? imageIndex : 0}
                    allMediaUrls={allMediaUrls.length > 0 ? allMediaUrls : undefined}
                    mediaTypes={allMediaTypes.length > 0 ? allMediaTypes : undefined}
                    mediaIndex={mediaIndex >= 0 ? mediaIndex : undefined}
                    onBeforeOpen={onBeforeOpen}
                    onPressIn={onImagePressIn}
                    onPressOut={onImagePressOut}
                    eventId={overlayEvent?.id}
                    overlayPost={overlayPost}
                  />
                );
              }
              case 'video': {
                const mediaIndex = mediaSegments.findIndex(
                  (m) => m.kind === 'video' && m.url === seg.url
                );
                const videoImeta = imetaByUrl.get(seg.url);
                const videoAspect =
                  videoImeta?.width && videoImeta?.height
                    ? videoImeta.width / videoImeta.height
                    : 16 / 9;
                const overlayLayout: Omit<
                  ImageOverlayLayout,
                  'pageX' | 'pageY' | 'width' | 'height'
                > = {
                  url: seg.url,
                  urls: allMediaUrls.length > 0 ? allMediaUrls : undefined,
                  mediaTypes: allMediaTypes.length > 0 ? allMediaTypes : undefined,
                  initialIndex: mediaIndex >= 0 ? mediaIndex : 0,
                  post: overlayPost,
                  aspectRatio: videoAspect,
                };
                return (
                  <VideoBlock
                    key={`b${i}`}
                    url={seg.url}
                    aspectRatio={videoAspect}
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
                return <LightningBlock key={`b${i}`} meltTarget={seg.meltTarget} />;
              case 'relay':
                return (
                  <RelayCard
                    key={`b${i}`}
                    url={seg.url}
                    noFetch={(relayOrdinalBySegment.get(i) ?? 0) >= RELAY_NIP11_FETCH_CAP}
                  />
                );
              case 'nevent':
              case 'note':
                return renderQuoteCard(seg.eventId, `b${i}`);
              default:
                return null;
            }
          });
        })()}
      {taggedQuoteIds.map((id) => renderQuoteCard(id, `q${id}`))}
    </VStack>
  );
});
