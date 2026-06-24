/**
 * Bottom panel components for the image overlay:
 * - ImageOverlayBottomPanelContent: scrollable author, content (with inline images), metrics
 * - ImageOverlayAbsoluteBar: author/stats bar when sheet is closed
 *
 * The live "Post your reply" composer is the shared `ThreadReplyBar`, mounted at
 * the overlay root by `AnimatedImageOverlay` (not here) so it can anchor to the
 * screen bottom and rise with the keyboard.
 * - InlinePanelImage: image with blurred letterbox for aspect ratio mismatch
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { formatRelative } from '@/shared/lib/date';
import { formatCount, formatSats } from '../feedFormat';
import { parseContent } from '../feedParse';
import type { ContentSegment } from '../feedTypes';
import type { ImageOverlayPost } from './types';
import { BOTTOM_PANEL_PADDING_HORIZONTAL, BOTTOM_PANEL_PADDING_TOP } from './config';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { COMMENT_ACCENT, LIKE_ACCENT } from '@/shared/lib/brandColors';
import { openRepostMenu } from '@/features/feed/lib/repostMenu';
import { useQuotePost } from '@/features/feed/lib/useQuotePost';
import { Log } from '@/shared/lib/logger';
import { POST_ACTION_ICON_SIZES } from '../MetricsFooter';

// The Repost/Quote menu can't render over the image overlay (a FullWindowOverlay
// the menu's bottom sheet mounts beneath), so the overlay closes first, then the
// menu opens once it's on its way out.
const OVERLAY_CLOSE_BEFORE_MENU_MS = 240;

/**
 * Repost handler for the overlay's repost buttons: dismiss the lightbox, then
 * open the shared Repost-or-Quote menu. `onRequestClose` is the overlay's close.
 */
function useOverlayRepostMenu(post: ImageOverlayPost, onRequestClose?: () => void) {
  const quotePost = useQuotePost();
  return () => {
    onRequestClose?.();
    setTimeout(() => {
      openRepostMenu({
        reposted: !!post.reposted,
        onRepost: () => post.onRepostPress?.(),
        onQuote: () => quotePost(post.event, post.profile ?? undefined),
      });
    }, OVERLAY_CLOSE_BEFORE_MENU_MS);
  };
}
// Absolute bar text stays white — it floats over the dark, blurred image, not
// over the sheet's `surface` background.
const PANEL_TEXT = 'rgba(255,255,255,0.95)';
const PANEL_TEXT_MUTED = 'rgba(255,255,255,0.6)';
const LIKED_COLOR = LIKE_ACCENT;

const PANEL_CONTENT_TRUNCATE_LIMIT = 120;
const PANEL_INLINE_IMAGE_MAX_HEIGHT = 200;
const PANEL_INLINE_IMAGE_BG = 'rgba(40, 40, 48, 0.95)';

type PanelBlock = { type: 'text'; value: string } | { type: 'image'; url: string };

/**
 * Heuristic: show inline images in the panel only when it looks like images might be captioned.
 * Show when either:
 * - There is non-whitespace text between two images, or
 * - An image has non-whitespace text both before and after it.
 * - Show: "text\n[img]\ntext", "holiday:\n[img]\n\nholiday pic two:\n[img]"
 * - Don't show: "[img][img2]\ntext" or "text\n[img][img2]"
 */
function shouldShowInlineImagesInPanel(blocks: PanelBlock[]): boolean {
  const imageIndices: number[] = [];
  const textIndicesWithContent: number[] = [];
  blocks.forEach((b, i) => {
    if (b.type === 'image') imageIndices.push(i);
    else if (b.type === 'text' && b.value.trim().length > 0) textIndicesWithContent.push(i);
  });
  if (imageIndices.length === 0 || textIndicesWithContent.length === 0) return false;
  // Text between two images → captioned
  for (const ti of textIndicesWithContent) {
    const hasImageBefore = imageIndices.some((ii) => ii < ti);
    const hasImageAfter = imageIndices.some((ii) => ii > ti);
    if (hasImageBefore && hasImageAfter) return true;
  }
  // Image between two text blocks → captioned
  for (const ii of imageIndices) {
    const hasTextBefore = textIndicesWithContent.some((ti) => ti < ii);
    const hasTextAfter = textIndicesWithContent.some((ti) => ti > ii);
    if (hasTextBefore && hasTextAfter) return true;
  }
  return false;
}

/** Build ordered blocks (text + image) from parsed segments for overlay panel. */
function segmentsToBlocks(segments: ContentSegment[]): PanelBlock[] {
  const blocks: PanelBlock[] = [];
  let textAcc = '';
  for (const seg of segments) {
    if (seg.kind === 'text') {
      textAcc += seg.text;
    } else if (seg.kind === 'newline') {
      textAcc += '\n';
    } else if (seg.kind === 'url') {
      textAcc += seg.url;
    } else if (seg.kind === 'hashtag') {
      textAcc += `#${seg.tag}`;
    } else if (seg.kind === 'image') {
      if (textAcc.length > 0) {
        blocks.push({ type: 'text', value: textAcc });
        textAcc = '';
      }
      blocks.push({ type: 'image', url: seg.url });
    }
  }
  if (textAcc.length > 0) blocks.push({ type: 'text', value: textAcc });
  return blocks;
}

/**
 * The text the author actually wrote, excluding bare image URLs (which render
 * as image blocks, not text). Truncation and the "show more" affordance key off
 * this so an image-only post — whose raw content is just a long media URL —
 * doesn't surface a lone "show more" sitting over empty/hidden text.
 */
function extractPanelText(content: string): string {
  return segmentsToBlocks(parseContent(content))
    .filter((b): b is Extract<PanelBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.value)
    .join('')
    .trim();
}

/** Renders an image full width at original aspect ratio, capped by max height; letterbox areas show a blurred cover of the same image. */
function InlinePanelImage({ uri }: { uri: string }) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [layoutWidth, setLayoutWidth] = useState<number>(0);
  const onLoad = (e: { source: { width: number; height: number } }) => {
    const { width, height } = e.source;
    if (!width || !height) return;
    setNaturalSize({ w: width, h: height });
  };
  const onLayout = (e: { nativeEvent: { layout: { width: number } } }) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  };
  const { boxHeight, imageStyle } = useMemo(() => {
    const placeholderHeight = 120;
    if (!layoutWidth) {
      return {
        boxHeight: placeholderHeight,
        imageStyle: {
          width: '100%' as const,
          height: placeholderHeight,
          borderRadius: 8,
          backgroundColor: PANEL_INLINE_IMAGE_BG,
        },
      };
    }
    if (!naturalSize) {
      const h = Math.min(placeholderHeight, PANEL_INLINE_IMAGE_MAX_HEIGHT);
      return {
        boxHeight: h,
        imageStyle: {
          width: layoutWidth,
          height: h,
          borderRadius: 8,
          backgroundColor: PANEL_INLINE_IMAGE_BG,
        },
      };
    }
    const { w, h } = naturalSize;
    const height = Math.min((layoutWidth * h) / w, PANEL_INLINE_IMAGE_MAX_HEIGHT);
    const boxHeight = Math.round(height);
    return {
      boxHeight,
      imageStyle: {
        width: layoutWidth,
        height: boxHeight,
        borderRadius: 8,
      },
    };
  }, [layoutWidth, naturalSize]);

  const showBlurredLetterbox = layoutWidth > 0 && naturalSize !== null;

  return (
    <View
      style={[
        styles.inlineImageWrap,
        { backgroundColor: PANEL_INLINE_IMAGE_BG, width: layoutWidth || '100%', height: boxHeight },
      ]}
      onLayout={onLayout}
      pointerEvents="none">
      {showBlurredLetterbox ? (
        <>
          <Image
            source={{ uri }}
            style={[StyleSheet.absoluteFill, { borderRadius: 8 }]}
            contentFit="cover"
            cachePolicy="disk"
          />
          <BlurView style={StyleSheet.absoluteFill} tint="dark" intensity={80} />
          <Image
            source={{ uri }}
            style={imageStyle}
            contentFit="contain"
            cachePolicy="disk"
            onLoad={onLoad}
          />
        </>
      ) : (
        <Image
          source={{ uri }}
          style={imageStyle}
          contentFit="contain"
          cachePolicy="disk"
          onLoad={onLoad}
        />
      )}
    </View>
  );
}

/** Scrollable part of the bottom panel: author, note content (with show more), metrics. */
export const ImageOverlayBottomPanelContent = React.memo(function ImageOverlayBottomPanelContent({
  post,
  initialContentExpanded,
  onConsumedExpand,
  onRequestClose,
}: {
  post: ImageOverlayPost;
  /** When true, content starts expanded (e.g. opened via "show more" on absolute bar). */
  initialContentExpanded?: boolean;
  /** Called after applying initialContentExpanded so caller can clear the flag. */
  onConsumedExpand?: () => void;
  /** Dismisses the lightbox so the Repost/Quote menu can render over it. */
  onRequestClose?: () => void;
}) {
  const [foreground, muted, repostedColor] = useThemeColor([
    'foreground',
    'muted',
    'success',
  ] as const);
  const repliedColor = COMMENT_ACCENT;
  const [contentExpanded, setContentExpanded] = useState(initialContentExpanded ?? false);

  useEffect(() => {
    if (initialContentExpanded) {
      setContentExpanded(true);
      onConsumedExpand?.();
    }
  }, [initialContentExpanded, onConsumedExpand]);
  const { event, metrics, profile, reposted, liked, replied, onLikePress } = post;
  const handleRepostPress = useOverlayRepostMenu(post, onRequestClose);
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatRelative(event.created_at * 1000, 'compact');
  const fullContent = event.content.trim();

  const { blocks, showInlineImages, textContent } = useMemo(() => {
    const allSegments = parseContent(fullContent);
    const allBlocks = segmentsToBlocks(allSegments);
    const showInline = shouldShowInlineImagesInPanel(allBlocks);
    // Bare image URLs render as image blocks, so the author's actual text drives
    // truncation/"show more" — never the raw media URL of an image-only post.
    const text = allBlocks
      .filter((b): b is Extract<PanelBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.value)
      .join('')
      .trim();
    if (text.length <= PANEL_CONTENT_TRUNCATE_LIMIT || contentExpanded) {
      return { blocks: allBlocks, showInlineImages: showInline, textContent: text };
    }
    let count = 0;
    const out: PanelBlock[] = [];
    for (const block of allBlocks) {
      if (block.type === 'text') {
        if (count + block.value.length > PANEL_CONTENT_TRUNCATE_LIMIT) {
          const take = PANEL_CONTENT_TRUNCATE_LIMIT - count;
          out.push({ type: 'text', value: block.value.slice(0, take) + '…' });
          return { blocks: out, showInlineImages: showInline, textContent: text };
        }
        out.push(block);
        count += block.value.length;
      } else {
        out.push(block);
      }
    }
    return { blocks: out, showInlineImages: showInline, textContent: text };
  }, [fullContent, contentExpanded]);

  const hasContent = textContent.length > 0;
  const canExpand = textContent.length > PANEL_CONTENT_TRUNCATE_LIMIT;
  const showMoreVisible = canExpand && !contentExpanded;
  const showLessVisible = canExpand && contentExpanded;

  return (
    <Log name="ImageOverlayBottomPanelContent">
      <View style={styles.wrap}>
        {/* Author row */}
        <Pressable
          onPress={() => {
            router.push({
              pathname: '/(user-flow)/profile',
              params: { pubkey: event.pubkey },
            });
          }}
          style={styles.authorRow}>
          <Avatar
            state={profile?.picture ? 'image' : 'fallback'}
            picture={profile?.picture}
            seed={event.pubkey}
            size={32}
            name={displayName}
          />
          <View style={styles.authorTextWrap}>
            <Text bold size={14} style={{ color: foreground }} numberOfLines={1}>
              {displayName}
            </Text>
            <Text size={13} style={{ color: muted }}>
              {shortTime}
            </Text>
          </View>
        </Pressable>
        {/* Post content with inline image blocks only when captioned (text between images); otherwise text only */}
        {hasContent ? (
          <View>
            {blocks.map((block, i) =>
              block.type === 'text' ? (
                <Text
                  key={i}
                  size={14}
                  style={[styles.contentText, { color: foreground }]}
                  numberOfLines={contentExpanded ? undefined : 2}>
                  {block.value}
                </Text>
              ) : showInlineImages ? (
                <InlinePanelImage key={i} uri={block.url} />
              ) : null
            )}
            {showMoreVisible && (
              <Text
                size={14}
                style={[styles.contentText, { color: muted, marginTop: 4 }]}
                onPress={() => setContentExpanded((e) => !e)}>
                show more
              </Text>
            )}
            {showLessVisible && (
              <Text
                size={14}
                style={[styles.contentText, { color: muted, marginTop: 4 }]}
                onPress={() => setContentExpanded((e) => !e)}>
                show less
              </Text>
            )}
          </View>
        ) : null}
        {/* Stats / actions row */}
        <View style={styles.metricsRow}>
          <View style={styles.metricBtn}>
            <Icon
              name="iconamoon:comment-fill"
              size={POST_ACTION_ICON_SIZES.regular.comment}
              color={replied ? repliedColor : muted}
            />
            <Text size={13} style={{ color: replied ? repliedColor : muted }}>
              {formatCount(metrics.replyCount)}
            </Text>
          </View>
          <Pressable
            onPress={handleRepostPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.metricBtn}>
            <Icon
              name="garden:arrow-retweet-fill-16"
              size={POST_ACTION_ICON_SIZES.regular.repost}
              color={reposted ? repostedColor : muted}
            />
            <Text size={13} style={{ color: reposted ? repostedColor : muted }}>
              {formatCount(metrics.repostCount)}
            </Text>
          </Pressable>
          <Pressable
            onPress={onLikePress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.metricBtn}>
            <Icon
              name="iconamoon:heart-fill"
              size={POST_ACTION_ICON_SIZES.regular.base}
              color={liked ? LIKED_COLOR : muted}
            />
            <Text size={13} style={{ color: liked ? LIKED_COLOR : muted }}>
              {formatCount(metrics.likeCount)}
            </Text>
          </Pressable>
          <View style={styles.metricBtn}>
            <Icon
              name="mingcute:lightning-fill"
              size={POST_ACTION_ICON_SIZES.regular.base}
              color={muted}
            />
            <Text overpass size={13} style={{ color: muted }}>
              {metrics.satsZapped > 0 ? formatSats(metrics.satsZapped) : '0'}
            </Text>
          </View>
        </View>
      </View>
    </Log>
  );
});

/** Options when opening the sheet from the absolute bar. */
type ImageOverlayOpenSheetOptions = { expandContent?: boolean };

/** Absolute overlay bar when sheet is closed: pfp, truncated content, show more, metric buttons. Tapping comment or show more opens the sheet. */
export const ImageOverlayAbsoluteBar = React.memo(function ImageOverlayAbsoluteBar({
  post,
  onOpenSheet,
  onRequestClose,
}: {
  post: ImageOverlayPost;
  /** Called when user taps comment or show more. Pass { expandContent: true } when opening via "show more" so the sheet opens with content expanded. */
  onOpenSheet: (options?: ImageOverlayOpenSheetOptions) => void;
  /** Dismisses the lightbox so the Repost/Quote menu can render over it. */
  onRequestClose?: () => void;
}) {
  const repostedColor = useThemeColor('success');
  const repliedColor = COMMENT_ACCENT;
  const handleRepostPress = useOverlayRepostMenu(post, onRequestClose);
  const { event, metrics, profile, reposted, liked, replied, onLikePress } = post;
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatRelative(event.created_at * 1000, 'compact');
  const fullContent = event.content.trim();
  const textContent = extractPanelText(fullContent);
  const contentPreview = textContent.slice(0, 120);
  const contentTruncated = textContent.length > 120;

  const handleCommentPress = () => {
    onOpenSheet();
  };

  const handleShowMorePress = () => {
    onOpenSheet({ expandContent: true });
  };

  return (
    <Log name="ImageOverlayAbsoluteBar">
      <View style={[styles.wrap, absoluteBarStyles.bar]}>
        <Pressable
          onPress={() => {
            router.push({
              pathname: '/(user-flow)/profile',
              params: { pubkey: event.pubkey },
            });
          }}
          style={styles.authorRow}>
          <Avatar
            state={profile?.picture ? 'image' : 'fallback'}
            picture={profile?.picture}
            seed={event.pubkey}
            size={28}
            name={displayName}
          />
          <View style={styles.authorTextWrap}>
            <Text bold size={13} style={{ color: PANEL_TEXT }} numberOfLines={1}>
              {displayName}
            </Text>
            <Text size={12} style={{ color: PANEL_TEXT_MUTED }}>
              {shortTime}
            </Text>
          </View>
        </Pressable>
        {textContent.length > 0 ? (
          <View style={absoluteBarStyles.contentRow}>
            <Text
              size={13}
              style={[styles.contentText, { color: PANEL_TEXT_MUTED }]}
              numberOfLines={1}>
              {contentPreview}
              {contentTruncated ? '…' : ''}
            </Text>
            {contentTruncated && (
              <Text
                size={13}
                style={[styles.contentText, absoluteBarStyles.showMore]}
                onPress={handleShowMorePress}>
                show more
              </Text>
            )}
          </View>
        ) : null}
        <View style={styles.metricsRow}>
          <Pressable
            onPress={handleCommentPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.metricBtn}>
            <Icon
              name="iconamoon:comment-fill"
              size={POST_ACTION_ICON_SIZES.regular.comment}
              color={replied ? repliedColor : PANEL_TEXT_MUTED}
            />
            <Text size={13} style={{ color: replied ? repliedColor : PANEL_TEXT_MUTED }}>
              {formatCount(metrics.replyCount)}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleRepostPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.metricBtn}>
            <Icon
              name="garden:arrow-retweet-fill-16"
              size={POST_ACTION_ICON_SIZES.regular.repost}
              color={reposted ? repostedColor : PANEL_TEXT_MUTED}
            />
            <Text size={13} style={{ color: reposted ? repostedColor : PANEL_TEXT_MUTED }}>
              {formatCount(metrics.repostCount)}
            </Text>
          </Pressable>
          <Pressable
            onPress={onLikePress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.metricBtn}>
            <Icon
              name="iconamoon:heart-fill"
              size={POST_ACTION_ICON_SIZES.regular.base}
              color={liked ? LIKED_COLOR : PANEL_TEXT_MUTED}
            />
            <Text size={13} style={{ color: liked ? LIKED_COLOR : PANEL_TEXT_MUTED }}>
              {formatCount(metrics.likeCount)}
            </Text>
          </Pressable>
          <View style={styles.metricBtn}>
            <Icon
              name="mingcute:lightning-fill"
              size={POST_ACTION_ICON_SIZES.regular.base}
              color={PANEL_TEXT_MUTED}
            />
            <Text overpass size={13} style={{ color: PANEL_TEXT_MUTED }}>
              {metrics.satsZapped > 0 ? formatSats(metrics.satsZapped) : '0'}
            </Text>
          </View>
        </View>
      </View>
    </Log>
  );
});

const absoluteBarStyles = StyleSheet.create({
  bar: {
    paddingVertical: 10,
    paddingBottom: 12,
  },
  contentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  showMore: {
    marginTop: 0,
  },
});

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: BOTTOM_PANEL_PADDING_HORIZONTAL,
    paddingTop: BOTTOM_PANEL_PADDING_TOP,
    gap: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authorTextWrap: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
  },
  contentText: {
    lineHeight: 20,
  },
  inlineImageWrap: {
    marginVertical: 6,
    borderRadius: 8,
    overflow: 'hidden',
    alignSelf: 'stretch',
    width: '100%',
    maxHeight: PANEL_INLINE_IMAGE_MAX_HEIGHT,
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  metricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});
