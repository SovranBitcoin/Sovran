/**
 * @fileoverview Sticky reply bar for the thread screen.
 *
 * Always present at the bottom of a thread: own avatar + "Post your reply".
 * Focused, it reveals a "Replying to @X" header and a picture / poll / Post
 * action row for a quick inline text+image reply (published via the shared
 * `publishComposed` seam). The poll button and the expand icon hand off to the
 * full composer (carrying the typed draft + the original post for context).
 * Sticks above the keyboard via `KeyboardStickyView`, like the chat composer.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { router } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { Button } from 'heroui-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { uploadMedia } from '@/shared/lib/nostr/media/mediaUpload';
import type { ComposerBlock } from '@/features/composer/config/types';
import { useComposerStore } from '@/features/composer/state/composerStore';
import { publishComposed } from '@/features/composer/publish/useComposerActions';
import { emptyPollDraft } from '@/features/composer/ui/PollComposeForm';
import { deriveReplyTarget } from '@/features/feed/lib/replyTarget';
import { useShiftLogger } from '@/features/feed/lib/contentShiftLog';
import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import type { FeedEvent, ProfileInfo } from '@/features/feed/components/nostr/feedTypes';

type MediaBlock = Extract<ComposerBlock, { kind: 'media' }>;

interface ThreadReplyBarProps {
  /**
   * The thread's main post — the bar replies to it by default. Optional so the
   * bar can render (pinned at the bottom) while the thread is still loading;
   * posting/expand stay disabled until the target event resolves.
   */
  targetEvent?: FeedEvent;
  targetProfile?: ProfileInfo;
  /** Reports the bar's measured height so the list can pad its bottom. */
  onHeightChange?: (height: number) => void;
}

let mediaSeq = 0;

// The bar grows on focus (header + action row appear). Animating the container's
// height with `LinearTransition` makes Yoga commit intermediate sizes each frame,
// so the bottom-anchored bar rises smoothly in step with the keyboard instead of
// snapping to its expanded height. ~250ms / ease-out roughly matches the iOS
// keyboard show curve. The revealed sections fade so their content doesn't pop.
const EXPAND_TRANSITION = LinearTransition.duration(250).easing(Easing.out(Easing.ease));
const SECTION_FADE_IN = FadeIn.duration(180);
const SECTION_FADE_OUT = FadeOut.duration(120);

export function ThreadReplyBar({
  targetEvent,
  targetProfile,
  onHeightChange,
}: ThreadReplyBarProps) {
  const { ndk } = useNDK();
  const insets = useSafeAreaInsets();
  // Only follow the keyboard while the thread is the active screen. When the
  // full composer modal is pushed on top (its own keyboard autofocuses), the
  // app-wide keyboard tracker would otherwise translate this bar up — so on a
  // back-gesture it slides down into place ("animates in from the top"). Gating
  // on focus keeps it pinned at the bottom (translateY = 0) behind the modal.
  const isFocused = useIsFocused();
  const [surface, foreground, muted, accent] = useThemeColor([
    'surface',
    'foreground',
    'muted',
    'accent',
  ] as const);
  const ownProfile = useProfileStore((s) => s.getActiveProfile());
  const inputRef = useRef<TextInput>(null);
  const shift = useShiftLogger('ThreadReplyBar');

  const [text, setText] = useState('');
  const [mediaBlocks, setMediaBlocks] = useState<MediaBlock[]>([]);
  const [focused, setFocused] = useState(false);
  const [posting, setPosting] = useState(false);

  const replyTarget = useMemo(
    () => (targetEvent ? deriveReplyTarget(targetEvent) : null),
    [targetEvent]
  );
  const targetName = targetEvent
    ? targetProfile?.name || `${tryNpubEncode(targetEvent.pubkey).slice(0, 12)}…`
    : '';

  const hasContent = text.trim().length > 0 || mediaBlocks.length > 0;
  const expanded = focused || hasContent;
  const uploading = mediaBlocks.some((b) => b.uploadProgress !== undefined);
  const canPost = !posting && hasContent && !uploading && !!replyTarget;

  const handlePost = useCallback(async () => {
    if (!ndk || !canPost || !replyTarget) return;
    setPosting(true);
    const blocks: ComposerBlock[] = [{ id: 'reply-text', kind: 'text', text }, ...mediaBlocks];
    const outcome = await publishComposed(ndk, { blocks, target: replyTarget });
    setPosting(false);
    if (outcome === 'ok') {
      setText('');
      setMediaBlocks([]);
      setFocused(false);
      inputRef.current?.blur();
      Keyboard.dismiss();
    }
  }, [ndk, canPost, text, mediaBlocks, replyTarget]);

  const handleAddMedia = useCallback(async () => {
    if (!ndk) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mediaKind = asset.type === 'video' ? 'video' : 'image';
    const mimeType = asset.mimeType ?? (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg');
    const id = `m${(mediaSeq += 1)}`;
    setMediaBlocks((prev) => [
      ...prev,
      { id, kind: 'media', mediaKind, localUri: asset.uri, uploadProgress: 0 },
    ]);

    const upload = await uploadMedia({
      ndk,
      asset: { uri: asset.uri, mimeType, width: asset.width, height: asset.height },
    });
    setMediaBlocks((prev) => {
      if (upload.isErr()) return prev.filter((b) => b.id !== id);
      return prev.map((b) =>
        b.id === id ? { ...b, descriptor: upload.value, uploadProgress: undefined } : b
      );
    });
  }, [ndk]);

  // Hand the current draft + reply context to the full composer.
  const expandToFull = useCallback(
    (withPoll: boolean) => {
      if (!replyTarget || !targetEvent) return;
      const store = useComposerStore.getState();
      store.open(replyTarget, { parentEvent: targetEvent, parentProfile: targetProfile });
      const firstText = useComposerStore.getState().blocks.find((b) => b.kind === 'text');
      if (firstText && text.length > 0) store.setBlockText(firstText.id, text);
      for (const block of mediaBlocks) {
        store.addMediaBlock({
          kind: 'media',
          mediaKind: block.mediaKind,
          localUri: block.localUri,
          descriptor: block.descriptor,
          alt: block.alt,
          sensitive: block.sensitive,
          uploadProgress: block.uploadProgress,
        });
      }
      if (withPoll) useComposerStore.getState().setPoll(emptyPollDraft());
      setText('');
      setMediaBlocks([]);
      setFocused(false);
      Keyboard.dismiss();
      router.navigate('/(user-flow)/composer');
    },
    [replyTarget, targetEvent, targetProfile, text, mediaBlocks]
  );

  const borderColor = opacity(foreground, 0.1);
  const fieldBg = opacity(foreground, 0.06);

  return (
    <KeyboardStickyView
      enabled={isFocused}
      // Anchored to the very bottom of the screen with the safe-area inset baked
      // into the container's padding, so the opaque background reaches the home
      // indicator and page content can't show through beneath the bar. When the
      // keyboard opens, `opened: insets.bottom` tucks that safe-area padding
      // behind the keyboard so the input still rests flush on the keyboard top.
      offset={{ closed: 0, opened: insets.bottom }}
      onLayout={(e) => {
        const height = e.nativeEvent.layout.height;
        // The bar grows on focus ("Replying to" header + action row) and when
        // media thumbnails attach. ThreadView pads the list by this height, so
        // any change here shifts how far the last reply sits above the bar.
        shift.report('thread.shift.replybar', 'height', height, {
          focused,
          expanded,
          mediaCount: mediaBlocks.length,
          posting,
        });
        onHeightChange?.(height);
      }}
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      <Animated.View
        layout={EXPAND_TRANSITION}
        style={[
          styles.container,
          {
            backgroundColor: surface,
            borderTopColor: borderColor,
            paddingBottom: insets.bottom + 10,
          },
        ]}>
        {expanded && targetEvent ? (
          <Animated.View entering={SECTION_FADE_IN} exiting={SECTION_FADE_OUT}>
            <Text size={12} style={{ color: muted, marginBottom: 8 }}>
              Replying to {targetName}
            </Text>
          </Animated.View>
        ) : null}

        {mediaBlocks.length > 0 ? (
          <HStack gap={8} style={{ marginBottom: 8 }}>
            {mediaBlocks.map((block) => (
              <View key={block.id}>
                <Image
                  source={{ uri: block.localUri ?? block.descriptor?.url }}
                  style={styles.thumb}
                  contentFit="cover"
                />
                {block.uploadProgress !== undefined ? (
                  <View style={styles.thumbScrim}>
                    <ActivityIndicator color={INVARIANT_WHITE} size="small" />
                  </View>
                ) : null}
                <Pressable
                  onPress={() => setMediaBlocks((prev) => prev.filter((b) => b.id !== block.id))}
                  hitSlop={8}
                  style={styles.thumbRemove}
                  accessibilityLabel="Remove media">
                  <Icon name="mdi:close-circle" size={18} color={INVARIANT_WHITE} />
                </Pressable>
              </View>
            ))}
          </HStack>
        ) : null}

        <HStack gap={8} align="center">
          <Avatar
            state={ownProfile?.cachedPicture ? 'image' : 'fallback'}
            picture={ownProfile?.cachedPicture}
            seed={ownProfile?.pubkey ?? ''}
            size={30}
            name={ownProfile?.cachedDisplayName}
          />
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Post your reply"
            placeholderTextColor={muted}
            multiline
            style={[styles.input, { color: foreground, backgroundColor: fieldBg }]}
          />
          <Pressable
            onPress={() => expandToFull(false)}
            disabled={!replyTarget}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Expand composer">
            <Icon name="mdi:arrow-expand" size={20} color={muted} />
          </Pressable>
        </HStack>

        {expanded ? (
          <Animated.View entering={SECTION_FADE_IN} exiting={SECTION_FADE_OUT}>
            <HStack gap={20} align="center" style={{ marginTop: 10 }}>
              <Pressable
                onPress={handleAddMedia}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add photo or video">
                <Icon name="mdi:image-plus" size={24} color={accent} />
              </Pressable>
              <Pressable
                onPress={() => expandToFull(true)}
                disabled={!replyTarget}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add poll">
                <Icon name="mdi:poll" size={24} color={accent} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Button variant="primary" size="sm" isDisabled={!canPost} onPress={handlePost}>
                <Button.Label>{posting ? 'Posting…' : 'Reply'}</Button.Label>
              </Button>
            </HStack>
          </Animated.View>
        ) : null}
      </Animated.View>
    </KeyboardStickyView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
  },
  thumb: { width: 64, height: 64, borderRadius: 10 },
  thumbScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  thumbRemove: { position: 'absolute', top: -6, right: -6 },
});
