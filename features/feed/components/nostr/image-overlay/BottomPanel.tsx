/**
 * Bottom panel components for the image overlay:
 * - ImageOverlayBottomPanelContent: scrollable author, content (with inline images), metrics
 * - ImageOverlayBottomPanelReply: fixed reply row at bottom of sheet
 * - ImageOverlayAbsoluteBar: author/stats bar when sheet is closed
 * - InlinePanelImage: image with blurred letterbox for aspect ratio mismatch
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import Icon from 'assets/icons';
import { Text } from '@/shared/ui/primitives/Text';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { formatTimestamp, formatCount, formatSats, parseContent } from '../shared';
import type { ContentSegment } from '../shared';
import type { ImageOverlayPost } from './types';
import { BOTTOM_PANEL_PADDING_HORIZONTAL, BOTTOM_PANEL_PADDING_TOP } from './config';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';
const PANEL_BG = 'rgba(0,0,0,0.9)';
const PANEL_TEXT = 'rgba(255,255,255,0.95)';
const PANEL_TEXT_MUTED = 'rgba(255,255,255,0.6)';
const LIKED_COLOR = '#ff5a7a';

const PANEL_CONTENT_TRUNCATE_LIMIT = 120;
const PANEL_INLINE_IMAGE_MAX_HEIGHT = 200;
const PANEL_INLINE_IMAGE_BG = 'rgba(40, 40, 48, 0.95)';

export { PANEL_BG };

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

/** Renders an image full width at original aspect ratio, capped by max height; letterbox areas show a blurred cover of the same image. */
function InlinePanelImage({ uri }: { uri: string }) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [layoutWidth, setLayoutWidth] = useState<number>(0);
  const onLoad = useCallback((e: { source: { width: number; height: number } }) => {
    const { width, height } = e.source;
    if (!width || !height) return;
    setNaturalSize({ w: width, h: height });
  }, []);
  const onLayout = useCallback((e: { nativeEvent: { layout: { width: number } } }) => {
    setLayoutWidth(e.nativeEvent.layout.width);
  }, []);
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
}: {
  post: ImageOverlayPost;
  /** When true, content starts expanded (e.g. opened via "show more" on absolute bar). */
  initialContentExpanded?: boolean;
  /** Called after applying initialContentExpanded so caller can clear the flag. */
  onConsumedExpand?: () => void;
}) {
  const repostedColor = useThemeColor('success');
  const [contentExpanded, setContentExpanded] = useState(initialContentExpanded ?? false);

  useEffect(() => {
    if (initialContentExpanded) {
      setContentExpanded(true);
      onConsumedExpand?.();
    }
  }, [initialContentExpanded, onConsumedExpand]);
  const { event, metrics, profile, reposted, liked, onRepostPress, onLikePress } = post;
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatTimestamp(event.created_at);
  const fullContent = event.content.trim();

  const { blocks, showInlineImages } = useMemo(() => {
    const allSegments = parseContent(fullContent);
    const allBlocks = segmentsToBlocks(allSegments);
    const showInline = shouldShowInlineImagesInPanel(allBlocks);
    if (fullContent.length <= PANEL_CONTENT_TRUNCATE_LIMIT || contentExpanded) {
      return { blocks: allBlocks, showInlineImages: showInline };
    }
    let count = 0;
    const out: PanelBlock[] = [];
    for (const block of allBlocks) {
      if (block.type === 'text') {
        if (count + block.value.length > PANEL_CONTENT_TRUNCATE_LIMIT) {
          const take = PANEL_CONTENT_TRUNCATE_LIMIT - count;
          out.push({ type: 'text', value: block.value.slice(0, take) + '…' });
          return { blocks: out, showInlineImages: showInline };
        }
        out.push(block);
        count += block.value.length;
      } else {
        out.push(block);
      }
    }
    return { blocks: out, showInlineImages: showInline };
  }, [fullContent, contentExpanded]);

  const hasContent = fullContent.length > 0;
  const canExpand = fullContent.length > PANEL_CONTENT_TRUNCATE_LIMIT;
  const showMoreVisible = canExpand && !contentExpanded;
  const showLessVisible = canExpand && contentExpanded;

  return (
    <Log name="ImageOverlayBottomPanelContent">
      <View style={styles.wrap}>
        {/* Author row */}
        <Pressable
          onPress={() => {
            router.navigate({
              pathname: '/(user-flow)/profile' as any,
              params: { pubkey: event.pubkey },
            });
          }}
          style={styles.authorRow}>
          <Avatar picture={profile?.picture} seed={event.pubkey} size={32} name={displayName} />
          <View style={styles.authorTextWrap}>
            <Text bold size={14} style={{ color: PANEL_TEXT }} numberOfLines={1}>
              {displayName}
            </Text>
            <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
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
                  style={[styles.contentText, { color: PANEL_TEXT_MUTED }]}
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
                style={[styles.contentText, { color: PANEL_TEXT_MUTED, marginTop: 4 }]}
                onPress={() => setContentExpanded((e) => !e)}>
                show more
              </Text>
            )}
            {showLessVisible && (
              <Text
                size={14}
                style={[styles.contentText, { color: PANEL_TEXT_MUTED, marginTop: 4 }]}
                onPress={() => setContentExpanded((e) => !e)}>
                show less
              </Text>
            )}
          </View>
        ) : null}
        {/* Stats / actions row */}
        <View style={styles.metricsRow}>
          <View style={styles.metricBtn}>
            <Icon name="iconamoon:comment-fill" size={16} color={PANEL_TEXT_MUTED} />
            <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
              {formatCount(metrics.replyCount)}
            </Text>
          </View>
          <Pressable
            onPress={onRepostPress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.metricBtn}>
            <Icon
              name="garden:arrow-retweet-fill-16"
              size={17}
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
              size={16}
              color={liked ? LIKED_COLOR : PANEL_TEXT_MUTED}
            />
            <Text size={13} style={{ color: liked ? LIKED_COLOR : PANEL_TEXT_MUTED }}>
              {formatCount(metrics.likeCount)}
            </Text>
          </Pressable>
          <View style={styles.metricBtn}>
            <Icon name="mingcute:lightning-fill" size={16} color={PANEL_TEXT_MUTED} />
            <Text overpass size={13} style={{ color: PANEL_TEXT_MUTED }}>
              {metrics.satsZapped > 0 ? formatSats(metrics.satsZapped) : '0'}
            </Text>
          </View>
        </View>
      </View>
    </Log>
  );
});

/** Fixed reply row shown at bottom of the sheet (does not scroll). */
export const ImageOverlayBottomPanelReply = React.memo(function ImageOverlayBottomPanelReply({
  currentUserPubkey,
  onReplyPress,
}: {
  currentUserPubkey: string | null;
  onReplyPress: () => void;
}) {
  return (
    <Log name="ImageOverlayBottomPanelReply">
      <Pressable onPress={onReplyPress} style={styles.replyRow}>
        <Avatar seed={currentUserPubkey ?? ''} size={28} name="" />
        <View style={styles.replyInputWrap}>
          <Text size={14} style={{ color: PANEL_TEXT_MUTED }}>
            Post your reply
          </Text>
        </View>
      </Pressable>
    </Log>
  );
});

/** Options when opening the sheet from the absolute bar. */
export type ImageOverlayOpenSheetOptions = { expandContent?: boolean };

/** Absolute overlay bar when sheet is closed: pfp, truncated content, show more, metric buttons. Tapping comment or show more opens the sheet. */
export const ImageOverlayAbsoluteBar = React.memo(function ImageOverlayAbsoluteBar({
  post,
  onOpenSheet,
}: {
  post: ImageOverlayPost;
  /** Called when user taps comment or show more. Pass { expandContent: true } when opening via "show more" so the sheet opens with content expanded. */
  onOpenSheet: (options?: ImageOverlayOpenSheetOptions) => void;
}) {
  const repostedColor = useThemeColor('success');
  const { event, metrics, profile, reposted, liked, onRepostPress, onLikePress } = post;
  const displayName = profile?.name ?? `${event.pubkey.slice(0, 8)}…`;
  const shortTime = formatTimestamp(event.created_at);
  const fullContent = event.content.trim();
  const contentPreview = fullContent.slice(0, 120);
  const contentTruncated = fullContent.length > 120;

  const handleCommentPress = useCallback(() => {
    onOpenSheet();
  }, [onOpenSheet]);

  const handleShowMorePress = useCallback(() => {
    onOpenSheet({ expandContent: true });
  }, [onOpenSheet]);

  return (
    <Log name="ImageOverlayAbsoluteBar">
    <View style={[styles.wrap, absoluteBarStyles.bar]}>
      <Pressable
        onPress={() => {
          router.navigate({
            pathname: '/(user-flow)/profile' as any,
            params: { pubkey: event.pubkey },
          });
        }}
        style={styles.authorRow}>
        <Avatar picture={profile?.picture} seed={event.pubkey} size={28} name={displayName} />
        <View style={styles.authorTextWrap}>
          <Text bold size={13} style={{ color: PANEL_TEXT }} numberOfLines={1}>
            {displayName}
          </Text>
          <Text size={12} style={{ color: PANEL_TEXT_MUTED }}>
            {shortTime}
          </Text>
        </View>
      </Pressable>
      {fullContent.length > 0 ? (
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
          <Icon name="iconamoon:comment-fill" size={16} color={PANEL_TEXT_MUTED} />
          <Text size={13} style={{ color: PANEL_TEXT_MUTED }}>
            {formatCount(metrics.replyCount)}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRepostPress}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.metricBtn}>
          <Icon
            name="garden:arrow-retweet-fill-16"
            size={17}
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
            size={16}
            color={liked ? LIKED_COLOR : PANEL_TEXT_MUTED}
          />
          <Text size={13} style={{ color: liked ? LIKED_COLOR : PANEL_TEXT_MUTED }}>
            {formatCount(metrics.likeCount)}
          </Text>
        </Pressable>
        <View style={styles.metricBtn}>
          <Icon name="mingcute:lightning-fill" size={16} color={PANEL_TEXT_MUTED} />
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

export const styles = StyleSheet.create({
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
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 20,
  },
  replyInputWrap: {
    flex: 1,
    justifyContent: 'center',
  },
});
