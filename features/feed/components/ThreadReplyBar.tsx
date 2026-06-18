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
import { Button } from 'heroui-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import type { FeedEvent, ProfileInfo } from '@/features/feed/components/nostr/feedTypes';

type MediaBlock = Extract<ComposerBlock, { kind: 'media' }>;

interface ThreadReplyBarProps {
  /** The thread's main post — the bar replies to it by default. */
  targetEvent: FeedEvent;
  targetProfile?: ProfileInfo;
  /** Reports the bar's measured height so the list can pad its bottom. */
  onHeightChange?: (height: number) => void;
}

let mediaSeq = 0;

export function ThreadReplyBar({
  targetEvent,
  targetProfile,
  onHeightChange,
}: ThreadReplyBarProps) {
  const { ndk } = useNDK();
  const insets = useSafeAreaInsets();
  const [surface, foreground, muted, accent] = useThemeColor([
    'surface',
    'foreground',
    'muted',
    'accent',
  ] as const);
  const ownProfile = useProfileStore((s) => s.getActiveProfile());
  const inputRef = useRef<TextInput>(null);

  const [text, setText] = useState('');
  const [mediaBlocks, setMediaBlocks] = useState<MediaBlock[]>([]);
  const [focused, setFocused] = useState(false);
  const [posting, setPosting] = useState(false);

  const replyTarget = useMemo(() => deriveReplyTarget(targetEvent), [targetEvent]);
  const targetName = targetProfile?.name || `${tryNpubEncode(targetEvent.pubkey).slice(0, 12)}…`;

  const hasContent = text.trim().length > 0 || mediaBlocks.length > 0;
  const expanded = focused || hasContent;
  const uploading = mediaBlocks.some((b) => b.uploadProgress !== undefined);
  const canPost = !posting && hasContent && !uploading;

  const handlePost = useCallback(async () => {
    if (!ndk || !canPost) return;
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
      offset={{ closed: 0, opened: 0 }}
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
      style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom }}>
      <View style={[styles.container, { backgroundColor: surface, borderTopColor: borderColor }]}>
        {expanded ? (
          <Text size={12} style={{ color: muted, marginBottom: 8 }}>
            Replying to {targetName}
          </Text>
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
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Expand composer">
            <Icon name="mdi:arrow-expand" size={20} color={muted} />
          </Pressable>
        </HStack>

        {expanded ? (
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
        ) : null}
      </View>
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
