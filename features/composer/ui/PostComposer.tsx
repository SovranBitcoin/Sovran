/**
 * @fileoverview The Nostr post composer surface.
 *
 * A single screen for new posts, replies, and quotes. Bound to the in-memory
 * `composerStore`: a multiline text field plus an inline media tray (pick →
 * upload to Blossom → descriptor). Toolbar controls are gated by the merged
 * `ComposeConfig`; the char meter enforces the relay-sourced budget; send goes
 * through the outbox-aware publish seam.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';
import { router } from 'expo-router';
import { Button } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Icon from 'assets/icons';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { uploadMedia } from '@/shared/lib/nostr/media/mediaUpload';
import { useComposeConfig } from '@/features/composer/config/useComposeConfig';
import { useComposerStore } from '@/features/composer/state/composerStore';
import {
  usePublishNote,
  type PublishOutcome,
} from '@/features/composer/publish/useComposerActions';
import { PollComposeForm, emptyPollDraft } from '@/features/composer/ui/PollComposeForm';
import { Text } from '@/shared/ui/primitives/Text';

const OUTCOME_MESSAGE: Partial<Record<PublishOutcome, string>> = {
  'no-key': 'No signing key available.',
  'media-pending': 'Wait for media to finish uploading.',
  empty: 'Write something or add media first.',
  'poll-invalid': 'A poll needs a question and at least 2 options.',
  failed: 'Could not publish to any relay. Try again.',
};

const PLACEHOLDER: Record<string, string> = {
  new: "What's happening?",
  reply: 'Post your reply',
  quote: 'Add a comment',
};

export function PostComposer() {
  const { ndk } = useNDK();
  const blocks = useComposerStore((s) => s.blocks);
  const target = useComposerStore((s) => s.target);
  const setBlockText = useComposerStore((s) => s.setBlockText);
  const addMediaBlock = useComposerStore((s) => s.addMediaBlock);
  const updateBlock = useComposerStore((s) => s.updateBlock);
  const removeBlock = useComposerStore((s) => s.removeBlock);
  const poll = useComposerStore((s) => s.poll);
  const setPoll = useComposerStore((s) => s.setPoll);
  const close = useComposerStore((s) => s.close);
  const config = useComposeConfig();
  const publish = usePublishNote();

  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [foreground, mutedColor, accentColor, dangerColor] = useThemeColor([
    'foreground',
    'muted',
    'accent',
    'danger',
  ] as const);

  const textBlock = blocks.find((b) => b.kind === 'text');
  const mediaBlocks = useMemo(() => blocks.filter((b) => b.kind === 'media'), [blocks]);
  const textLength = textBlock?.kind === 'text' ? textBlock.text.length : 0;
  const remaining = config.charBudget - textLength;
  const overBudget = remaining < 0;
  const uploading = mediaBlocks.some((b) => b.kind === 'media' && b.uploadProgress !== undefined);
  const canPost = !busy && !overBudget && !uploading;

  const handleCancel = useCallback(() => {
    close();
    router.back();
  }, [close]);

  const handlePost = useCallback(async () => {
    setBusy(true);
    setError(null);
    const outcome = await publish();
    setBusy(false);
    if (outcome === 'ok') {
      router.back();
      return;
    }
    setError(OUTCOME_MESSAGE[outcome] ?? 'Something went wrong.');
  }, [publish]);

  const handleAddMedia = useCallback(async () => {
    if (!ndk || mediaBlocks.length >= config.maxMedia) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mediaKind = asset.type === 'video' ? 'video' : 'image';
    const mimeType = asset.mimeType ?? (mediaKind === 'video' ? 'video/mp4' : 'image/jpeg');

    const id = addMediaBlock({
      kind: 'media',
      mediaKind,
      localUri: asset.uri,
      uploadProgress: 0,
    });

    const upload = await uploadMedia({
      ndk,
      asset: { uri: asset.uri, mimeType, width: asset.width, height: asset.height },
    });
    if (upload.isOk()) {
      updateBlock(id, { descriptor: upload.value, uploadProgress: undefined });
    } else {
      removeBlock(id);
      setError('Media upload failed. Try a different file.');
    }
  }, [ndk, mediaBlocks.length, config.maxMedia, addMediaBlock, updateBlock, removeBlock]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        className="flex-row items-center justify-between px-4 pb-3"
        style={{ paddingTop: insets.top + 12 }}>
        <Button variant="ghost" size="sm" onPress={handleCancel}>
          <Button.Label>Cancel</Button.Label>
        </Button>
        <Button variant="primary" size="sm" onPress={handlePost} isDisabled={!canPost}>
          <Button.Label>{busy ? 'Posting…' : 'Post'}</Button.Label>
        </Button>
      </View>

      <ScrollView className="flex-1 px-4" keyboardShouldPersistTaps="handled">
        <TextInput
          value={textBlock?.kind === 'text' ? textBlock.text : ''}
          onChangeText={(text) => textBlock && setBlockText(textBlock.id, text)}
          placeholder={PLACEHOLDER[target?.mode ?? 'new']}
          placeholderTextColor={mutedColor}
          multiline
          autoFocus
          style={{ color: foreground, fontSize: 17, minHeight: 120, paddingTop: 8 }}
        />

        {mediaBlocks.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-3">
            {mediaBlocks.map((block) =>
              block.kind === 'media' ? (
                <View key={block.id} className="mr-2">
                  <Image
                    source={{ uri: block.localUri ?? block.descriptor?.url }}
                    style={{ width: 96, height: 96, borderRadius: 12 }}
                    contentFit="cover"
                  />
                  {block.uploadProgress !== undefined ? (
                    <View
                      className="absolute inset-0 items-center justify-center"
                      style={styles.uploadScrim}>
                      <ActivityIndicator color={INVARIANT_WHITE} />
                    </View>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onPress={() => removeBlock(block.id)}
                    accessibilityLabel="Remove media">
                    <Icon name="mdi:close-circle" size={18} color={mutedColor} />
                  </Button>
                </View>
              ) : null
            )}
          </ScrollView>
        ) : null}

        {poll ? <PollComposeForm /> : null}

        {error ? (
          <Text size={13} className="mt-3" style={{ color: dangerColor }}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      <View
        className="flex-row items-center gap-4 px-4 pt-3"
        style={{
          paddingBottom: insets.bottom + 12,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: mutedColor,
        }}>
        <Button
          variant="ghost"
          size="sm"
          onPress={handleAddMedia}
          isDisabled={!!poll || mediaBlocks.length >= config.maxMedia}
          accessibilityLabel="Add photo or video">
          <Icon
            name="mdi:image-plus"
            size={22}
            color={poll || mediaBlocks.length >= config.maxMedia ? mutedColor : accentColor}
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => setPoll(poll ? undefined : emptyPollDraft())}
          isDisabled={!config.allowPoll || mediaBlocks.length > 0}
          accessibilityLabel={poll ? 'Remove poll' : 'Add poll'}>
          <Icon
            name="mdi:poll"
            size={22}
            color={
              !config.allowPoll || mediaBlocks.length > 0
                ? mutedColor
                : poll
                  ? accentColor
                  : mutedColor
            }
          />
        </Button>
        <View className="flex-1" />
        <Text size={13} style={{ color: overBudget ? dangerColor : mutedColor }}>
          {remaining}
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  uploadScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});
