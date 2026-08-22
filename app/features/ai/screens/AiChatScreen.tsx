import { useCallback, useEffect, useMemo, useState } from 'react';
import { Keyboard, ScrollView, View as RNView } from 'react-native';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';

import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { PatternBackground } from '@/shared/ui/composed/PatternBackground';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  useRoutstrStore,
  type ChatAttachment,
  type RoutstrMessage,
} from '@/shared/stores/profile/routstrStore';
import { LiquidChatComposer } from '@/shared/ui/composed/chat/LiquidChatComposer';
import { E2EActionMenuProbe, E2EHerouiMenuProbe } from '@/shared/lib/popup/E2EActionMenuProbe';
import {
  useChatKeyboardAnimationLogger,
  useChatSurfacePerfLogger,
  useComposerHeight,
  useLoggedChatSend,
} from '@/shared/ui/composed/chat/useChatSurfacePerfLogger';
import { aiLog, useLifecycleLogger } from '@/shared/lib/logger';
import { isExpo55NativeTabsSupported } from '@/navigation/nativeTabs';
import {
  SOVRAN_TAB_BAR_ROW_HEIGHT,
  SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING,
} from '@/shared/blocks/SovranTabBar';
import { ModelChip } from '../components/ModelChip';
import { AiEmptyState } from '../components/AiEmptyState';
import { AiMessageBubble, type BranchNav } from '../components/AiMessageBubble';
import { useAiSend } from '../hooks/useAiSend';
import { resolveSelectedEntry } from '../lib/format';
import { pickChatImage } from '../lib/attachments';
import { MAX_INLINE_IMAGES } from '../lib/assembleApiMessages';
import { deriveActivePath, getSiblingInfo, withSynthesisedParents } from '../lib/branching';

const SURFACE = 'ai';

// Horizontal gutter applied to every message row (FlashList rows have no
// padding of their own). Stable module ref so recycled cells don't re-create it.
const MESSAGE_ROW_STYLE = { paddingHorizontal: 16 } as const;

/** Visual gap between the composer's outer bottom edge and the keyboard top
 *  when focused. Matches the shared ChatScreen — 0pt reads as "the composer
 *  is sitting on the keyboard" instead of floating mid-air. */
const COMPOSER_FOCUSED_BOTTOM_GAP = 0;

/**
 * AI tab chat surface. Built directly on FlashList rather than going
 * through the shared `<ChatScreen />` because the AI surface needs a
 * bubble-less assistant renderer + ModelChip row inline with the composer.
 * The shared `<ChatScreen />` (BitChat, WhiteNoise, Nostr DM, geohash) is
 * also FlashList-backed now, so the architecture is consistent: ascending
 * data, FlashList `maintainVisibleContentPosition` (`startRenderingFromBottom`
 * for the chat-style bottom dock, `autoscrollToBottomThreshold` for
 * stay-at-latest), and a Reanimated translate driving the keyboard lift for
 * both list and composer in lock-step.
 *
 * FlashList replaced the previous GiftedChat / inverted FlatList stack
 * across all chat surfaces; iOS 26 applies a soft `UIScrollEdgeEffect` to
 * RN `FlatList` / `VirtualizedList` instances by default that surfaces as
 * a visible band where the list meets the composer, and FlashList's
 * separate virtualization sidesteps it cleanly.
 */
export function AiChatScreen() {
  useLifecycleLogger('AiChatScreen');

  // On AiChatScreen MOUNT (not every focus), archive any in-progress
  // conversation and start fresh. The surface stays mounted across tab
  // switches (LazyTabContent only mounts once per session), so this
  // effectively fires:
  //   • Cold start of the app
  //   • Account/profile switch (re-mounts the account-scoped tree)
  //   • Hard reload during development
  //
  // It does NOT fire when:
  //   • Switching tabs (Wallet → AI etc.) — screen stays mounted
  //   • Opening a popup (sessions menu, ModelChip dropdown) — focus
  //     changes but mount is preserved
  //   • Keyboard show/hide — same as above
  //
  // Earlier implementation used `useFocusEffect` and fired on every
  // re-focus, which wiped the conversation any time a popup closed —
  // user reported the obvious bug. Prior conversations remain accessible
  // via `openAiSessionsMenu` (the header-right clock icon).
  useEffect(() => {
    const store = useRoutstrStore.getState();
    if (store.conversationHistory.length === 0) return;
    aiLog.info('ai.session.auto_new_on_mount', {
      archivedCount: store.conversationHistory.length,
    });
    store.createSession();
  }, []);

  const insets = useSafeAreaInsets();
  // Two tab-bar paths, two different bottom-inset shapes:
  //   • NativeTabs (iOS 26+ liquid glass): real `UITabBarController` grows
  //     the screen's bottom safe-area inset to cover tab bar + home-indicator
  //     together. The composer sits at `bottom: insets.bottom` over a
  //     full-screen frame and lands flush above the bar.
  //   • SovranTabBar (older iOS / Android): JS tab bar that already absorbs
  //     the home-indicator inset itself. Pass 0 so the composer sits flush
  //     against the bar instead of floating above it.
  const isNativeTabsPath = isExpo55NativeTabsSupported();
  const bottomInset = isNativeTabsPath ? insets.bottom : 0;
  // On the SovranTabBar path the screen-content area stops at the tab bar's
  // top edge, which sits `sovranTabBarHeight` above the window bottom. The
  // composer is anchored at `bottom: 0` of that content area — i.e., already
  // `sovranTabBarHeight` above the window bottom at rest — so the keyboard
  // lift below must subtract this gap or the composer overshoots the keyboard
  // top by the tab bar's height when focused. On the NativeTabs path the
  // screen extends to the window bottom under a translucent system bar, so
  // this gap is 0 and `bottomInset` already captures the right offset.
  const sovranTabBarHeight = isNativeTabsPath
    ? 0
    : SOVRAN_TAB_BAR_ROW_HEIGHT + Math.max(insets.bottom, SOVRAN_TAB_BAR_MIN_BOTTOM_PADDING);
  const headerHeight = useHeaderHeight();

  const surfaceColor = useThemeColor('surface');

  const conversationHistory = useRoutstrStore((s) => s.conversationHistory);
  const activeChildren = useRoutstrStore((s) => s.activeChildren);
  const setActiveBranch = useRoutstrStore((s) => s.setActiveBranch);

  // Vision gate for the composer's [+]: image attach is only offered when
  // the model the current (provider, tier) slot resolves to accepts image
  // input. Falls to disabled while no lineup exists yet (first run before
  // the catalog fetch lands).
  const selectedTier = useRoutstrStore((s) => s.selectedTier);
  const selectedProvider = useRoutstrStore((s) => s.selectedProvider);
  const balanceMsats = useRoutstrStore((s) => s.balance);
  const sessionLineup = useRoutstrStore((s) => s.lineup);
  const lastKnownLineup = useRoutstrStore((s) => s.lastKnownLineup);
  const resolvedEntry = useMemo(
    () =>
      resolveSelectedEntry(
        selectedProvider,
        selectedTier,
        balanceMsats != null ? Math.floor(balanceMsats / 1000) : 0,
        sessionLineup ?? lastKnownLineup?.lineup ?? null
      ),
    [selectedProvider, selectedTier, balanceMsats, sessionLineup, lastKnownLineup]
  );
  const canAttachImages = resolvedEntry?.visionInput === true;

  const { send, retry, isSending, streamingMessageId } = useAiSend();

  const activeMessages = useMemo(
    () => deriveActivePath(conversationHistory, activeChildren),
    [conversationHistory, activeChildren]
  );

  // Mount visibility — narrow set, fires once. No imperative scroll-chase
  // plumbing: FlashList's `maintainVisibleContentPosition` with
  // `startRenderingFromBottom` docks short content and lands the first paint at
  // the latest message, and `autoscrollToBottomThreshold` keeps the user pinned
  // during streaming appends. Earlier attempts at setTimeout-based chasers
  // landed mid-list when item measurements settled async — fragile for
  // streaming content. Trust the library; reach for telemetry if it regresses.
  useEffect(() => {
    aiLog.info('ai.list.mount', {
      messageCount: activeMessages.length,
      bottomInset,
      headerHeight,
    });
    return () => {
      aiLog.info('ai.list.unmount', {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const branchNavById = useMemo(() => {
    const map = new Map<string, BranchNav>();
    const normalized = withSynthesisedParents(conversationHistory);
    for (const m of activeMessages) {
      if (m.role !== 'assistant') continue;
      const info = getSiblingInfo(m.id, normalized);
      if (!info) continue;
      const onPrev =
        info.index > 1
          ? () => setActiveBranch(m.parentId ?? '', info.siblings[info.index - 2].id)
          : undefined;
      const onNext =
        info.index < info.total
          ? () => setActiveBranch(m.parentId ?? '', info.siblings[info.index].id)
          : undefined;
      map.set(m.id, { index: info.index, total: info.total, onPrev, onNext });
    }
    return map;
  }, [activeMessages, conversationHistory, setActiveBranch]);

  const handleRetry = useCallback(
    (messageId: string) => {
      aiLog.info('ai.retry.dispatch', { messageId });
      void retry(messageId);
    },
    [retry]
  );

  // Composer state (draft + pending image attachments + measured height
  // for list bottom padding). Attachments accumulate via repeated single
  // picks (PostComposer's maxMedia pattern) and clear on successful
  // dispatch.
  const [draft, setDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [composerHeight, handleComposerLayout] = useComposerHeight();

  // Picked-but-unsent images are only valid against a vision-capable
  // model. If the user switches the slot to a text-only model after
  // picking, drop them (the strip disappearing is the visible feedback) —
  // otherwise submit would carry images the resolved model must reject.
  useEffect(() => {
    if (canAttachImages) return;
    setPendingAttachments((prev) => {
      if (prev.length === 0) return prev;
      aiLog.info('ai.attach.cleared_on_model_switch', { dropped: prev.length });
      return [];
    });
  }, [canAttachImages]);

  // Composer + list both ride the keyboard via a single shared translate
  // (UI thread, no Yoga re-layout per frame). The math:
  //
  //   translateY = keyboardHeight.value
  //              + keyboardProgress.value * (bottomInset + sovranTabBarHeight - COMPOSER_FOCUSED_BOTTOM_GAP)
  //
  // `keyboardHeight` is the keyboard's animated pixel height; RNKC's convention is
  // *negative* when the keyboard is shown (negative translateY = up). At rest
  // it's 0, so translateY is 0. At fully open, it's roughly `-keyboardH`, plus
  // a `progress`-driven term that brings the composer back DOWN by the distance
  // between its rest anchor and the window bottom — `bottomInset` on the
  // NativeTabs path (composer floats `insets.bottom` above the window bottom)
  // or `sovranTabBarHeight` on the SovranTabBar path (composer sits at `bottom:
  // 0` of a screen-content area whose floor is already `sovranTabBarHeight`
  // above the window bottom). Without the `sovranTabBarHeight` term the
  // SovranTabBar path overshoots the keyboard top by the bar's height when
  // focused — exactly the "too much margin" symptom. The same translate is
  // applied to a wrapper around the FlashList so the latest message rises
  // with the composer instead of getting hidden behind the keyboard.
  //
  // Why this instead of `<KeyboardAvoidingView behavior="padding">`: in RN's
  // Yoga layout, `position: 'absolute', bottom: X` children are positioned
  // relative to the parent's border box, not its padding box — so the KAV's
  // added `paddingBottom` doesn't lift the absolutely-positioned composer.
  // Driving the lift via Reanimated's translateY sidesteps the issue and
  // keeps the work on the UI thread.
  const { progress: keyboardProgress, height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const keyboardLiftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          keyboardHeight.value +
          keyboardProgress.value * (bottomInset + sovranTabBarHeight - COMPOSER_FOCUSED_BOTTOM_GAP),
      },
    ],
  }));

  const dispatchSend = useLoggedChatSend({
    log: aiLog,
    surface: SURFACE,
    send,
    dispatchExtras: (text: string, attachments: ChatAttachment[]) => ({
      textLen: text.length,
      attachmentCount: attachments.length,
      historyCount: activeMessages.length,
    }),
  });

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    const attachments = pendingAttachments;
    setDraft('');
    setPendingAttachments([]);
    void dispatchSend(text, attachments).catch(() => {
      // Errors already logged; consumer's onSend is expected to surface
      // user-visible feedback (popups/banners).
    });
  }, [draft, pendingAttachments, dispatchSend]);

  // [+] → system photo library. Attachments cap at the per-request inline
  // budget; the button dims when the resolved model can't accept images.
  const handlePlusPress = useCallback(() => {
    if (pendingAttachments.length >= MAX_INLINE_IMAGES) {
      aiLog.info('ai.attach.limit_reached', { max: MAX_INLINE_IMAGES });
      return;
    }
    void pickChatImage().then((picked) => {
      if (!picked) return;
      setPendingAttachments((prev) =>
        prev.length >= MAX_INLINE_IMAGES ? prev : [...prev, picked]
      );
    });
  }, [pendingAttachments.length]);

  const handleRemoveAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Perf loggers — same canonical emits the shared ChatScreen produces, so
  // the AI surface stays observable in chat.kav.* and chat.list.history_change
  // dashboards. The logger only reads `id` off each message; passing the
  // raw `RoutstrMessage[]` is enough.
  useChatSurfacePerfLogger({
    log: aiLog,
    surface: SURFACE,
    headerHeight,
    messages: activeMessages,
  });
  useChatKeyboardAnimationLogger({ log: aiLog, surface: SURFACE });

  const renderItem = useCallback(
    ({ item }: { item: RoutstrMessage; index: number }) => (
      <RNView style={MESSAGE_ROW_STYLE}>
        <AiMessageBubble
          message={item}
          isStreaming={item.id === streamingMessageId}
          onRetry={isSending ? undefined : handleRetry}
          branchNav={branchNavById.get(item.id)}
        />
      </RNView>
    ),
    [branchNavById, handleRetry, isSending, streamingMessageId]
  );

  const keyExtractor = useCallback((m: RoutstrMessage) => m.id, []);

  // Tap-to-dismiss-keyboard on the empty placeholder mirrors the previous
  // behaviour. Mounted in place of the list when there are no messages; the
  // composer stays mounted over the top, ready to accept the first message.
  const emptyContent = useMemo(
    () => (
      <Pressable
        onPress={Keyboard.dismiss}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        accessible={false}
        importantForAccessibility="no">
        <AiEmptyState />
      </Pressable>
    ),
    []
  );

  // Pad bottom of the list so the newest bubble rests just above the
  // composer's top edge while the composer itself is absolutely positioned
  // over the chat — older bubbles slide *under* the composer's translucent
  // glass on scroll-up (the iMessage / Telegram bleed-under-input look).
  // No `paddingTop` here: adding one breaks `alignItemsAtEnd`'s
  // "content < viewport → dock to bottom" math (the contentContainer's
  // own paddingTop counts toward effective content height, so FlashList
  // thinks the viewport is already filled and skips the auto-bottom
  // padding it would otherwise insert). The AI Stack header is its own
  // opaque/translucent surface above the screen scene; content sliding
  // under it on scroll is the intended chat UX.
  const listContentContainerStyle = useMemo(
    () => ({
      paddingBottom: composerHeight + bottomInset + 16,
    }),
    [composerHeight, bottomInset]
  );

  return (
    <RNView style={{ flex: 1, backgroundColor: surfaceColor }}>
      <PatternBackground />
      {/* List wrapper rides the keyboard via the same shared translate as
          the composer. When the keyboard opens, both shift up together so
          the latest message stays just above the composer instead of
          getting hidden behind the keyboard. */}
      <Reanimated.View style={[{ flex: 1 }, keyboardLiftStyle]}>
        <RNView style={{ flex: 1 }}>
          {activeMessages.length === 0 ? (
            <RNView style={{ flex: 1 }}>{emptyContent}</RNView>
          ) : (
            <FlashList
              data={activeMessages}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              // Chat-bottom behavior via FlashList v2's maintainVisibleContentPosition:
              // - `startRenderingFromBottom` lands the first paint at the latest
              //   message AND docks short histories to the bottom (replacing
              //   FlashList's `initialScrollAtEnd` + `alignItemsAtEnd`).
              // - `autoscrollToBottomThreshold` keeps the viewport pinned to the
              //   latest as streaming tokens append, while the user is near the
              //   bottom (replacing `maintainScrollAtEnd` + threshold).
              // mVCP also anchors the visible item when bubbles above the viewport
              // resize/measure late.
              maintainVisibleContentPosition={{
                startRenderingFromBottom: true,
                autoscrollToBottomThreshold: 0.1,
              }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={listContentContainerStyle}
            />
          )}
        </RNView>
      </Reanimated.View>

      <Reanimated.View
        style={[
          { position: 'absolute', left: 0, right: 0, bottom: bottomInset },
          keyboardLiftStyle,
        ]}>
        <RNView onLayout={handleComposerLayout}>
          {pendingAttachments.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                paddingHorizontal: 12,
                gap: 8,
                paddingBottom: 8,
              }}
              style={{ flexGrow: 0 }}>
              {pendingAttachments.map((attachment, index) => (
                <RNView key={`${attachment.localUri}-${index}`}>
                  <Image
                    source={{ uri: attachment.localUri }}
                    style={{ width: 56, height: 56, borderRadius: 10 }}
                    contentFit="cover"
                    accessibilityLabel="Pending image attachment"
                  />
                  <Pressable
                    onPress={() => handleRemoveAttachment(index)}
                    hitSlop={8}
                    accessibilityLabel="Remove attachment"
                    accessibilityRole="button"
                    testID={`ai-attachment-remove-${index}`}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      backgroundColor: surfaceColor,
                      borderRadius: 10,
                    }}>
                    <Icon name="mdi:close-circle" size={20} />
                  </Pressable>
                </RNView>
              ))}
            </ScrollView>
          ) : null}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{
              paddingHorizontal: 12,
              gap: 8,
              alignItems: 'center',
            }}
            style={{ flexGrow: 0 }}>
            <ModelChip />
          </ScrollView>
          <LiquidChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={handleSubmit}
            disabled={isSending}
            placeholder="Ask anything"
            onPlusPress={handlePlusPress}
            plusDisabled={!canAttachImages}
            testID="ai-input"
            surface={SURFACE}
          />
        </RNView>
      </Reanimated.View>
      {/* The header-right clock opens the Conversations menu (heroui
          actionMenuPopup, FWO — rows AX-invisible); mirror its open state so
          e2e can wait on it, same as WalletScreen / FeedScreen. */}
      <E2EHerouiMenuProbe />
      {/* The model chip opens the model-picker FWO custom-sheet (the OTHER
          probe lane, e2e-action-menu-open) — mount its probe here too. */}
      <E2EActionMenuProbe />
    </RNView>
  );
}
