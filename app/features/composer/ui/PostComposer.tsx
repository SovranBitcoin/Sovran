/**
 * @fileoverview The Nostr post composer surface.
 *
 * A single screen for new posts, replies, and quotes. Bound to the in-memory
 * `composerStore`: a multiline text field plus an inline media tray (pick →
 * upload to Blossom → descriptor). Toolbar controls are gated by the merged
 * `ComposeConfig`; the char meter enforces the relay-sourced budget; send goes
 * through the outbox-aware publish seam.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
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
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useUploadAbortMap } from '@/shared/hooks/useUploadAbortMap';
import { uploadMediaBlocks } from '@/shared/lib/nostr/media/uploadMediaBlocks';
import { useOwnedMediaStore } from '@/shared/stores/profile/ownedMediaStore';
import { useComposeConfig } from '@/features/composer/config/useComposeConfig';
import { useComposerStore } from '@/features/composer/state/composerStore';
import {
  usePublishNote,
  type PublishOutcome,
} from '@/features/composer/publish/useComposerActions';
import { PollComposeForm, emptyPollDraft } from '@/features/composer/ui/PollComposeForm';
import { PostProgressBar } from '@/features/composer/ui/PostProgressBar';
import type { ComposerBlock } from '@/features/composer/config/types';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { NoteContent, QuotedPostCard } from '@/features/feed/components/nostr/NoteContent';
import { THREAD_CONNECTOR_LINE_STYLE } from '@/features/feed/components/nostr/threadConnectorStyle';
import {
  useShiftLogger,
  useVisualScrollMetricsLogger,
  useVisualStateLogger,
} from '@/shared/lib/contentShiftLog';
import { VisualLayoutProbe } from '@/shared/ui/composed/VisualLayoutProbe';
import { tryNpubEncode } from '@/features/feed/components/nostr/feedParse';
import {
  DEFAULT_METRICS,
  type FeedEvent,
  type NoteMetrics,
  type ProfileInfo,
} from '@/features/feed/components/nostr/feedTypes';
import { alpha, spacing } from '@/shared/styles/tokens';

const AVATAR_SIZE = 36;
const EMPTY_EVENTS = new Map<string, FeedEvent>();
const stubMetrics = (): NoteMetrics => DEFAULT_METRICS;

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

const COMPOSER_VISUAL_SCOPE = 'composer.post';

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
  const parentEvent = useComposerStore((s) => s.parentEvent);
  const parentProfile = useComposerStore((s) => s.parentProfile);
  const close = useComposerStore((s) => s.close);
  const config = useComposeConfig();
  const publish = usePublishNote();

  const insets = useSafeAreaInsets();
  // Keyboard-aware toolbar inset: when the keyboard is up the toolbar already
  // sits flush on the keyboard top, so the home-indicator inset would be dead
  // space below it. Collapse it while typing.
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => setKeyboardVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Segmented posting progress (image legs + the final post leg). Null when not
  // mid-post or when there are no images to upload.
  const [postProgress, setPostProgress] = useState<{ done: number; total: number } | null>(null);
  // Synchronous re-entrancy guard: `busy` is async state, so a fast double-tap
  // can clear the `if (!canPost)` check twice before the first render disables
  // the button. This blocks the second invocation immediately.
  const postingRef = useRef(false);
  // Media block whose alt text is being edited, with its in-progress value.
  const [altEdit, setAltEdit] = useState<{ id: string; value: string } | null>(null);
  const [surface, foreground, mutedColor, accentColor, dangerColor, lineColor] = useThemeColor([
    'surface',
    'foreground',
    'muted',
    'accent',
    'danger',
    'default',
  ] as const);
  const ownProfile = useProfileStore((s) => s.getActiveProfile());

  const isReply = target?.mode === 'reply' && !!parentEvent;
  const isQuote = target?.mode === 'quote' && !!parentEvent;
  // Profiles map for the quoted card: just the quoted author, so its avatar and
  // display name resolve without a feed-wide profile map.
  const quotedProfiles = useMemo(() => {
    const map = new Map<string, ProfileInfo>();
    if (parentEvent && parentProfile) map.set(parentEvent.pubkey, parentProfile);
    return map;
  }, [parentEvent, parentProfile]);
  const textBlock = blocks.find((b) => b.kind === 'text');
  const mediaBlocks = useMemo(() => blocks.filter((b) => b.kind === 'media'), [blocks]);
  const textLength = textBlock?.kind === 'text' ? textBlock.text.length : 0;
  const hasPostContent =
    (textBlock?.kind === 'text' && textBlock.text.trim().length > 0) || mediaBlocks.length > 0;
  const remaining = config.charBudget - textLength;
  const overBudget = remaining < 0;
  const uploading = mediaBlocks.some((b) => b.kind === 'media' && b.uploadProgress !== undefined);
  const canPost = !busy && hasPostContent && !overBudget && !uploading;
  const showPollBeforeQuote = isQuote && !!poll;
  const composerPhase = busy
    ? 'posting'
    : uploading
      ? 'uploading'
      : keyboardVisible
        ? 'typing'
        : 'editing';
  const composerScrollMetrics = useVisualScrollMetricsLogger({
    scope: COMPOSER_VISUAL_SCOPE,
    surface: 'composer',
    component: 'PostComposerScrollView',
    axis: 'y',
    phase: composerPhase,
    extra: () => ({
      mode: target?.mode ?? 'new',
      keyboardVisible,
      textLength,
      mediaCount: mediaBlocks.length,
      hasPoll: !!poll,
      showPollBeforeQuote,
      overBudget,
    }),
  });
  const mediaTrayScrollMetrics = useVisualScrollMetricsLogger({
    enabled: mediaBlocks.length > 0,
    scope: COMPOSER_VISUAL_SCOPE,
    surface: 'composer',
    component: 'PostComposerMediaTrayScrollView',
    axis: 'x',
    phase: composerPhase,
    extra: () => ({
      mode: target?.mode ?? 'new',
      mediaCount: mediaBlocks.length,
      uploading,
    }),
  });
  useVisualStateLogger({
    scope: COMPOSER_VISUAL_SCOPE,
    surface: 'composer',
    component: 'PostComposer',
    stateKey: 'composer-state',
    phase: composerPhase,
    state: {
      mode: target?.mode ?? 'new',
      keyboardVisible,
      busy,
      textLength,
      mediaCount: mediaBlocks.length,
      uploading,
      hasPoll: !!poll,
      showPollBeforeQuote,
      overBudget,
      canPost,
      hasError: !!error,
    },
    remeasure: {
      reason: 'composer-state',
      minIntervalMs: 250,
      maxItems: 24,
    },
  });

  const handleCancel = useCallback(() => {
    close();
    router.back();
  }, [close]);

  const uploadsRef = useUploadAbortMap();

  const handlePost = useCallback(async () => {
    if (postingRef.current || !canPost) return;
    postingRef.current = true;
    setBusy(true);
    setError(null);

    // Upload is deferred to here: re-encode + PUT every media block that has no
    // descriptor yet, then publish. Abort the whole post if any upload fails so
    // we never publish a note missing one of its images.
    const pending = mediaBlocks.filter(
      (b): b is Extract<ComposerBlock, { kind: 'media' }> =>
        b.kind === 'media' && !b.descriptor && !!b.localUri
    );
    const imageCount = pending.length;
    if (imageCount > 0) setPostProgress({ done: 0, total: imageCount + 1 });

    let done = 0;
    try {
      if (!ndk) throw { type: 'no-ndk' };
      // The upload machinery (per-block abort registration, abort-siblings →
      // allSettled → record-orphans on failure) lives in uploadMediaBlocks —
      // shared with ThreadReplyBar so the orphan protocol can't diverge.
      await uploadMediaBlocks({
        ndk,
        blocks: pending,
        uploads: uploadsRef.current,
        patchBlock: updateBlock,
        onBlockUploaded: () => {
          done += 1;
          if (imageCount > 0) setPostProgress({ done, total: imageCount + 1 });
        },
        onOrphans: (orphans) => useOwnedMediaStore.getState().recordBlobs(orphans),
      });
    } catch (e) {
      postingRef.current = false;
      setBusy(false);
      setPostProgress(null);
      const type = (e as { type?: string }).type;
      // A cancel (block removed mid-upload) is silent; everything else surfaces.
      setError(
        type === 'canceled'
          ? null
          : type === 'too-large'
            ? 'That file is too large to upload.'
            : 'Media upload failed. Try again.'
      );
      return;
    }

    const outcome = await publish();
    postingRef.current = false;
    setBusy(false);
    if (outcome === 'ok') {
      if (imageCount > 0) setPostProgress({ done: imageCount + 1, total: imageCount + 1 });
      router.back();
      return;
    }
    setPostProgress(null);
    setError(OUTCOME_MESSAGE[outcome] ?? 'Something went wrong.');
  }, [canPost, publish, mediaBlocks, ndk, updateBlock, uploadsRef]);

  const handleAddMedia = useCallback(async () => {
    if (mediaBlocks.length >= config.maxMedia) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // Defer the upload to Post: store the local asset only. A mis-pick costs no
    // network work, and the user can remove it before anything is uploaded.
    addMediaBlock({
      kind: 'media',
      mediaKind: 'image',
      localUri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      width: asset.width,
      height: asset.height,
    });
  }, [mediaBlocks.length, config.maxMedia, addMediaBlock]);

  // Cancel any in-flight upload before dropping the block.
  const handleRemoveMedia = useCallback(
    (id: string) => {
      uploadsRef.current.get(id)?.abort();
      uploadsRef.current.delete(id);
      removeBlock(id);
    },
    [removeBlock, uploadsRef]
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: surface }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <VisualLayoutProbe
        scope={COMPOSER_VISUAL_SCOPE}
        surface="composer"
        component="PostComposerHeader"
        itemKey="header"
        itemType="header"
        style={[
          styles.headerRow,
          {
            paddingTop: insets.top + spacing.md,
          },
        ]}
        extra={{
          mode: target?.mode ?? 'new',
          keyboardVisible,
          busy,
        }}>
        <Button variant="ghost" size="md" onPress={handleCancel}>
          <Button.Label>Cancel</Button.Label>
        </Button>
        <Button
          variant="primary"
          size="sm"
          onPress={handlePost}
          isDisabled={!canPost}
          style={!canPost ? styles.disabledPostButton : undefined}>
          <Button.Label>{busy ? 'Posting…' : 'Post'}</Button.Label>
        </Button>
      </VisualLayoutProbe>

      <VisualLayoutProbe
        scope={COMPOSER_VISUAL_SCOPE}
        surface="composer"
        component="PostComposerBody"
        itemKey="body"
        itemType="scroll"
        style={styles.flex1}
        extra={{
          mode: target?.mode ?? 'new',
          mediaCount: mediaBlocks.length,
          hasPoll: !!poll,
          showPollBeforeQuote,
        }}>
        <ScrollView
          className="flex-1 px-4"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={isReply ? styles.replyScrollContent : undefined}
          onLayout={composerScrollMetrics.onLayout}
          onContentSizeChange={composerScrollMetrics.onContentSizeChange}
          onScroll={composerScrollMetrics.onScroll}
          scrollEventThrottle={250}>
          {isReply && parentEvent ? (
            <ReplyOriginalPost
              event={parentEvent}
              profile={parentProfile}
              lineColor={lineColor}
              foreground={foreground}
              muted={mutedColor}
            />
          ) : null}
          <View style={isReply ? styles.replyInputRow : undefined}>
            {isReply ? (
              <View style={styles.gutterCol}>
                <View
                  style={[
                    styles.lineAbove,
                    THREAD_CONNECTOR_LINE_STYLE,
                    { borderLeftColor: lineColor },
                  ]}
                />
                <Avatar
                  state={ownProfile?.cachedPicture ? 'image' : 'fallback'}
                  picture={ownProfile?.cachedPicture}
                  seed={ownProfile?.pubkey ?? ''}
                  size={AVATAR_SIZE}
                  name={ownProfile?.cachedDisplayName}
                />
              </View>
            ) : null}
            <TextInput
              value={textBlock?.kind === 'text' ? textBlock.text : ''}
              onChangeText={(text) => textBlock && setBlockText(textBlock.id, text)}
              placeholder={PLACEHOLDER[target?.mode ?? 'new']}
              placeholderTextColor={mutedColor}
              multiline
              autoFocus
              style={[styles.input, { color: foreground }, isReply ? styles.inputReply : null]}
            />
          </View>

          {showPollBeforeQuote ? <PollComposeForm /> : null}

          {isQuote && parentEvent ? (
            <View style={styles.quotedWrap}>
              <QuotedPostCard
                event={parentEvent}
                profiles={quotedProfiles}
                getMetrics={stubMetrics}
              />
            </View>
          ) : null}

          {mediaBlocks.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-3"
              onLayout={mediaTrayScrollMetrics.onLayout}
              onContentSizeChange={mediaTrayScrollMetrics.onContentSizeChange}
              onScroll={mediaTrayScrollMetrics.onScroll}
              scrollEventThrottle={250}>
              {mediaBlocks.map((block) =>
                block.kind === 'media' ? (
                  <VisualLayoutProbe
                    key={block.id}
                    scope={COMPOSER_VISUAL_SCOPE}
                    surface="composer"
                    component="PostComposerMediaBlock"
                    itemKey={block.id}
                    itemType={block.mediaKind}
                    className="mr-2"
                    extra={{
                      uploading: block.uploadProgress !== undefined,
                      uploadProgress: block.uploadProgress ?? null,
                    }}>
                    <Image
                      source={{ uri: block.localUri ?? block.descriptor?.url }}
                      style={{ width: 96, height: 96, borderRadius: 12 }}
                      contentFit="cover"
                    />
                    {block.uploadProgress !== undefined ? (
                      <View
                        className="absolute inset-0 items-center justify-center"
                        style={styles.uploadScrim}>
                        <VisualLayoutProbe
                          scope={COMPOSER_VISUAL_SCOPE}
                          surface="composer"
                          component="PostComposerMediaUploadIndicator"
                          itemKey={`media-upload:${block.id}`}
                          itemType="activity-indicator"
                          phase="uploading"
                          extra={{
                            mediaKind: block.mediaKind,
                            uploadProgress: block.uploadProgress ?? null,
                          }}>
                          <ActivityIndicator color={INVARIANT_WHITE} />
                        </VisualLayoutProbe>
                        {block.uploadProgress > 0 ? (
                          <Text
                            size={11}
                            style={{
                              color: INVARIANT_WHITE,
                              marginTop: 4,
                              fontVariant: ['tabular-nums'],
                            }}>
                            {Math.round(block.uploadProgress * 100)}%
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                    {config.allowAltText && block.uploadProgress === undefined ? (
                      <Pressable
                        onPress={() => setAltEdit({ id: block.id, value: block.alt ?? '' })}
                        accessibilityLabel={block.alt ? 'Edit alt text' : 'Add alt text'}
                        style={[
                          styles.altBadge,
                          block.alt ? { backgroundColor: accentColor } : null,
                        ]}>
                        <Text size={10} style={{ color: INVARIANT_WHITE, fontWeight: '700' }}>
                          {block.alt ? 'ALT ✓' : 'ALT'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={() => handleRemoveMedia(block.id)}
                      accessibilityLabel="Remove media">
                      <Icon name="mdi:close-circle" size={18} color={mutedColor} />
                    </Button>
                  </VisualLayoutProbe>
                ) : null
              )}
            </ScrollView>
          ) : null}

          {!showPollBeforeQuote && poll ? <PollComposeForm /> : null}

          {error ? (
            <Text size={13} className="mt-3" style={{ color: dangerColor }}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </VisualLayoutProbe>

      {postProgress ? (
        <PostProgressBar done={postProgress.done} total={postProgress.total} failed={!!error} />
      ) : null}

      <VisualLayoutProbe
        scope={COMPOSER_VISUAL_SCOPE}
        surface="composer"
        component="PostComposerToolbar"
        itemKey="toolbar"
        itemType="toolbar"
        className="flex-row items-center gap-5 px-4 py-2"
        style={{
          paddingBottom: keyboardVisible ? 10 : insets.bottom + 10,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: mutedColor,
        }}
        extra={{
          mode: target?.mode ?? 'new',
          keyboardVisible,
          mediaCount: mediaBlocks.length,
          hasPoll: !!poll,
          canPost,
        }}>
        <Pressable
          onPress={handleAddMedia}
          disabled={!!poll || mediaBlocks.length >= config.maxMedia}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Add photo or video">
          <Icon
            name="mdi:image-plus"
            size={24}
            color={poll || mediaBlocks.length >= config.maxMedia ? mutedColor : accentColor}
          />
        </Pressable>
        <Pressable
          onPress={() => setPoll(poll ? undefined : emptyPollDraft())}
          disabled={!config.allowPoll || mediaBlocks.length > 0}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={poll ? 'Remove poll' : 'Add poll'}>
          <Icon
            name="mdi:poll"
            size={24}
            color={
              !config.allowPoll || mediaBlocks.length > 0
                ? mutedColor
                : poll
                  ? accentColor
                  : mutedColor
            }
          />
        </Pressable>
        <View className="flex-1" />
        <Text size={13} style={{ color: overBudget ? dangerColor : mutedColor }}>
          {remaining}
        </Text>
      </VisualLayoutProbe>

      <Modal
        visible={!!altEdit}
        transparent
        animationType="fade"
        onRequestClose={() => setAltEdit(null)}>
        <Pressable style={styles.altBackdrop} onPress={() => setAltEdit(null)}>
          <Pressable style={[styles.altCard, { backgroundColor: surface }]}>
            <Text size={15} style={{ color: foreground, fontWeight: '600', marginBottom: 6 }}>
              Describe this image
            </Text>
            <Text size={12} style={{ color: mutedColor, marginBottom: 12 }}>
              Alt text helps people using screen readers understand the image.
            </Text>
            <TextInput
              value={altEdit?.value ?? ''}
              onChangeText={(text) =>
                setAltEdit((prev) => (prev ? { ...prev, value: text } : prev))
              }
              placeholder="e.g. A dog running on a beach at sunset"
              placeholderTextColor={mutedColor}
              multiline
              autoFocus
              style={[styles.altInput, { color: foreground, borderColor: lineColor }]}
            />
            <View style={styles.altActions}>
              <Pressable onPress={() => setAltEdit(null)} accessibilityLabel="Cancel alt text">
                <Text size={14} style={{ color: mutedColor, fontWeight: '600' }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!altEdit) return;
                  const trimmed = altEdit.value.trim();
                  updateBlock(altEdit.id, { alt: trimmed.length > 0 ? trimmed : undefined });
                  setAltEdit(null);
                }}
                accessibilityLabel="Save alt text">
                <Text size={14} style={{ color: accentColor, fontWeight: '700' }}>
                  Save
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

/**
 * The post being replied to, rendered in full above the input with a dotted
 * connector running from its avatar down to the composer's own avatar.
 */
function ReplyOriginalPost({
  event,
  profile,
  lineColor,
  foreground,
  muted,
}: {
  event: FeedEvent;
  profile?: ProfileInfo;
  lineColor: string;
  foreground: string;
  muted: string;
}) {
  const name = profile?.name || `${tryNpubEncode(event.pubkey).slice(0, 12)}…`;
  const shift = useShiftLogger('ReplyOriginalPost');
  const profiles = useMemo(() => {
    const map = new Map<string, ProfileInfo>();
    if (profile) map.set(event.pubkey, profile);
    return map;
  }, [event.pubkey, profile]);

  return (
    <VisualLayoutProbe
      scope={COMPOSER_VISUAL_SCOPE}
      surface="composer"
      component="ReplyOriginalPost"
      itemKey={event.id}
      itemType="reply-original"
      style={styles.ogRow}
      onLayout={(e) => {
        // The replied-to post renders in full above the input; its height (which
        // grows as the OG note's media/quotes resolve) pushes the input and the
        // connecting line down. Log shifts so the reply view's jumps are traceable.
        shift.report('composer.shift.reply_original', event.id, e.nativeEvent.layout.height, {
          contentLength: event.content.length,
        });
      }}
      extra={{ contentLength: event.content.length }}>
      <View style={styles.gutterCol}>
        <Avatar
          state={profile?.picture ? 'image' : 'fallback'}
          picture={profile?.picture}
          seed={event.pubkey}
          size={AVATAR_SIZE}
          name={name}
        />
        <View
          style={[styles.lineBelow, THREAD_CONNECTOR_LINE_STYLE, { borderLeftColor: lineColor }]}
        />
      </View>
      <View style={styles.ogContent}>
        <Text bold size={15} style={{ color: foreground, marginBottom: 2 }} numberOfLines={1}>
          {name}
        </Text>
        <NoteContent
          content={event.content}
          event={event}
          profiles={profiles}
          quotedEvents={EMPTY_EVENTS}
          getMetrics={stubMetrics}
        />
        <Text size={13} style={{ color: muted, marginTop: 6 }}>
          Replying to {name}
        </Text>
      </View>
    </VisualLayoutProbe>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: spacing.sm,
    paddingRight: spacing.lg,
    paddingBottom: spacing.md,
  },
  ogRow: { flexDirection: 'row', gap: 12, paddingTop: 12 },
  ogContent: { flex: 1 },
  gutterCol: { width: AVATAR_SIZE, alignItems: 'center' },
  lineAbove: {
    position: 'absolute',
    top: 0,
    left: AVATAR_SIZE / 2 - 1,
    height: AVATAR_SIZE / 2,
  },
  lineBelow: { flex: 1, marginTop: 6 },
  // Top-align the reply content so the replied-to post stays pinned at the top
  // and does not move when the keyboard shows/hides (the scroll viewport resizes
  // from the bottom). `flexGrow` lets the input fill the remaining space.
  replyScrollContent: {
    flexGrow: 1,
  },
  replyInputRow: { flexDirection: 'row', gap: 12, paddingTop: 4 },
  quotedWrap: { marginTop: 4 },
  // Start at a single line; a multiline TextInput grows on its own as content
  // wraps, so no minHeight is forced.
  input: { fontSize: 17, paddingTop: 8 },
  inputReply: {
    flex: 1,
    minHeight: 72,
    paddingBottom: spacing['2xl'],
    marginBottom: spacing.md,
  },
  disabledPostButton: { opacity: alpha.disabled },
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
  flex1: {
    flex: 1,
  },
  altBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  altBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  altCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
  },
  altInput: {
    minHeight: 72,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 10,
    textAlignVertical: 'top',
  },
  altActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    marginTop: 16,
  },
});
