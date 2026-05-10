import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, Platform } from 'react-native';
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
import opacity from 'hex-color-opacity';
import { decode as bolt11Decode } from '@gandlaf21/bolt11-decode';
import { log } from '@/shared/lib/logger';
import { openExternalUrl } from '@/shared/lib/url';
import { staticPopup } from '@/shared/lib/popup';
import { ImageBlock, useImageOverlay } from './image-overlay';
import type { ImageOverlayLayout, ImageOverlayPost } from './image-overlay';
import { usePaymentFlowMachine } from 'coco-payment-ux/react';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ContentSegment, FeedEvent, NoteMetrics, ProfileInfo } from './feedTypes';
import { parseContent, prettifyUrl, tryNpubEncode } from './feedParse';
import { formatRelative } from '@/shared/lib/date';
import { sharedStyles } from './feedStyles';

const EMPTY_QUOTED_EVENTS: Map<string, FeedEvent> = new Map();

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
      size={15}
      style={{ color: opacity(foreground, 0.5) }}
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
    <Text bold size={15} style={{ color: opacity(foreground, 0.5) }}>
      #{tag}
    </Text>
  );
});

const InlineLink = React.memo(function InlineLink({
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
      onPress={async () => {
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

const VideoBlockInner = React.memo(function VideoBlockInner({
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
  const surface = useThemeColor('surface');
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);
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

  const handleTap = useCallback(() => {
    if (openOverlay && overlayLayout && containerRef.current) {
      onBeforeOpen?.();
      containerRef.current.measureInWindow(
        (pageX: number, pageY: number, width: number, height: number) => {
          openOverlay({ ...overlayLayout, pageX, pageY, width, height });
        }
      );
    } else if (isAndroid) {
      (onTap ?? openInBrowser)();
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

// Decode the bolt11 once at memo time. A meltTarget that fails decoding is
// rendered as a non-tappable "Invalid Lightning invoice" chip so a relay-
// supplied lnbc-shaped string can never reach `machine.execute`. When decode
// succeeds, the chip surfaces the amount so the user knows what they're
// tapping into before the payment machine takes over.
function decodeFeedInvoice(invoice: string): { amountSat: number | null } | null {
  try {
    const decoded = bolt11Decode(invoice);
    const msats = decoded?.sections?.find((s: { name?: string }) => s?.name === 'amount')?.value;
    const sats = typeof msats === 'string' ? Number(msats) / 1000 : Number(msats ?? 0) / 1000;
    return { amountSat: Number.isFinite(sats) && sats > 0 ? sats : null };
  } catch {
    return null;
  }
}

const LightningBlock = React.memo(function LightningBlock({ meltTarget }: { meltTarget: string }) {
  const [foreground, surface, surfaceTertiary] = useThemeColor([
    'foreground',
    'surface',
    'surface-tertiary',
  ] as const);
  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const decoded = useMemo(() => decodeFeedInvoice(meltTarget), [meltTarget]);

  if (!decoded) {
    return (
      <View
        style={[
          sharedStyles.mediaCard,
          { backgroundColor: surface, borderColor: surfaceTertiary },
        ]}>
        <HStack align="center" gap={8}>
          <Icon name="mingcute:lightning-fill" size={20} color={opacity(foreground, 0.2)} />
          <VStack style={sharedStyles.flex1}>
            <Text bold size={13} style={{ color: opacity(foreground, 0.4) }}>
              Invalid Lightning invoice
            </Text>
            <Text size={11} numberOfLines={1} style={{ color: opacity(foreground, 0.25) }}>
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
        void machine.execute(meltTarget, { reset: true });
      }}
      style={[sharedStyles.mediaCard, { backgroundColor: surface, borderColor: surfaceTertiary }]}>
      <HStack align="center" gap={8}>
        <Icon name="mingcute:lightning-fill" size={20} color={opacity(foreground, 0.4)} />
        <VStack style={sharedStyles.flex1}>
          <Text bold size={13} style={{ color: opacity(foreground, 0.66) }}>
            Lightning Invoice
          </Text>
          <Text size={11} numberOfLines={1} style={{ color: opacity(foreground, 0.33) }}>
            {subtitle}
          </Text>
        </VStack>
        <Icon name="mdi:chevron-right" size={18} color={opacity(foreground, 0.33)} />
      </HStack>
    </Pressable>
  );
});

// ─── QuotedPostCard ──────────────────────────────────────────────────────────

const QuotedPostCard = React.memo(function QuotedPostCard({
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
          <Icon name="mdi:message-text" size={14} color={opacity(foreground, 0.33)} />
          <Text size={13} italic style={{ color: opacity(foreground, 0.33) }}>
            Quoted post
          </Text>
        </HStack>
      </View>
    );
  }

  const timestamp = event.created_at ? formatRelative(event.created_at * 1000, 'compact') : '';
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
                return <LightningBlock key={`b${i}`} meltTarget={seg.meltTarget} />;
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
