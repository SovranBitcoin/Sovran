import React, { useState } from 'react';
import {
  Keyboard,
  ScrollView,
  StyleSheet,
  View as RNView,
  type LayoutChangeEvent,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardStickyView,
  useReanimatedKeyboardAnimation,
} from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { FlashList } from '@shopify/flash-list';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import type { Logger } from '@/shared/lib/logger';

import { LiquidChatComposer } from './LiquidChatComposer';
import { ChatMessageBubble } from './ChatMessageBubble';
import {
  useChatKeyboardAnimationLogger,
  useChatSurfacePerfLogger,
} from './useChatSurfacePerfLogger';
import { useMessageGrouping } from './useMessageGrouping';
import type { ChatBubbleMessage, ChatBubbleRenderArgs } from './types';

interface ChatScreenProps {
  surface: string;
  log: Logger;
  /**
   * Optional in-screen header (e.g. `<DmChatHeader />`). Surfaces that mount
   * their header via the navigation Stack (e.g. AI tab's `<AiHeaderTitle />`
   * inside `Stack.Screen.headerTitle`) leave this `undefined`.
   */
  header?: React.ReactNode;
  messages: ChatBubbleMessage[];
  onSend: (text: string) => Promise<unknown> | unknown;
  composerDisabled?: boolean;
  composerPlaceholder?: string;
  composerOnPlusPress?: () => void;
  composerOnVoicePress?: () => void;
  /**
   * Optional row of action buttons rendered ABOVE the LiquidChatComposer
   * inside the same sticky container — so it rides up with the keyboard
   * exactly like the input. Pass any number of `<Button>`s; they lay out in
   * a horizontal scroll view that doesn't dismiss the keyboard on tap.
   * Use for surface-level shortcuts like "Send Money", "Attach", etc.
   */
  composerActions?: React.ReactNode;
  composerTestID?: string;
  banner?: React.ReactNode;
  isLoading?: boolean;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  /**
   * Extra inset between the composer and the bottom edge of the screen, used
   * by surfaces sitting underneath a translucent system tab bar (the AI
   * tab's NativeTabs). When omitted, falls back to the bottom safe-area inset
   * so standalone surfaces (DMs) clear the home indicator. An explicit `0`
   * is honored — surfaces above a JS tab bar that already absorbs the home
   * indicator pass `0` so the composer sits flush against the bar instead
   * of floating above it.
   */
  bottomInset?: number;
  /**
   * Extra inset between the chat list and the top edge of the screen, used
   * by surfaces with a transparent floating navigation header (AI tab) so
   * the topmost bubble doesn't slide *under* the header on initial paint.
   * Surfaces that render their own in-area header (DmChatHeader) leave this 0.
   */
  topInset?: number;
  /**
   * Render override for individual messages. Default is `ChatMessageBubble`
   * (sender/own colored bubble pair). The AI surface passes its own renderer
   * to keep assistant replies bubble-less while user pills stay bubbled.
   */
  renderBubble?: (args: ChatBubbleRenderArgs) => React.ReactNode;
  /**
   * Avatar override for non-own messages. Pass `null` to hide the avatar
   * column entirely (e.g. ephemeral group chats with no identity). Ignored
   * when `renderBubble` is supplied.
   */
  counterpartyAvatar?: React.ReactNode | null;
  historyExtras?: (last: ChatBubbleMessage | undefined) => Record<string, unknown>;
  kbStateExtras?: () => Record<string, unknown>;
  /**
   * Fired when the user scrolls to the START (top) of the history — used to
   * load older messages (server-paginated threads). `maintainVisibleContentPosition`
   * already keeps the viewport anchored when older bubbles prepend.
   */
  onStartReached?: () => void;
  onStartReachedThreshold?: number;
}

// Horizontal gutter applied to every message row (FlashList rows have no
// padding of their own). Stable module ref so recycled cells don't re-create it.
const MESSAGE_ROW_STYLE = { paddingHorizontal: 16 } as const;

/**
 * Shared chat surface backed by `@shopify/flash-list`. Used by BitChat, Nostr
 * DM, WhiteNoise, geohash — every DM-like chat surface. Architecture mirrors
 * `AiChatScreen` (which uses FlashList directly): forward-ordered data,
 * FlashList `maintainVisibleContentPosition` with `startRenderingFromBottom`
 * for the chat-style bottom dock and `autoscrollToBottomThreshold` for
 * stay-at-latest on append, plus a single shared Reanimated translate that
 * lifts both the list wrapper and the (absolutely-positioned) composer in
 * lock-step with the keyboard.
 *
 * Previously this surface was built on `react-native-gifted-chat` (inverted
 * FlatList + internal KeyboardAvoidingView). Two reasons we switched:
 *   1. iOS 26 applies a soft `UIScrollEdgeEffect` to RN `FlatList` /
 *      `VirtualizedList` instances by default — visible as a blur/fade band
 *      where the list meets the composer. FlashList's separate
 *      virtualization sidesteps it entirely, matching the AI surface.
 *   2. GiftedChat's KAV interaction with our `position:'absolute'` composer
 *      was unreliable across border-box positioning and modal-stack contexts
 *      — sometimes lifting it under the keyboard, sometimes double-lifting
 *      it. Owning the lift on our side via a Reanimated translate makes the
 *      math identical across full-screen and modal-stack surfaces.
 *
 * Each consumer is responsible for mapping its native event into
 * `ChatBubbleMessage[]`; everything below that is shared.
 */
const keyExtractor = (m: ChatBubbleMessage) => m.id;

export function ChatScreen({
  surface,
  log,
  header: _header,
  messages,
  onSend,
  composerDisabled,
  composerPlaceholder,
  composerOnPlusPress,
  composerOnVoicePress,
  composerActions,
  composerTestID,
  banner,
  isLoading,
  loadingContent,
  emptyContent,
  bottomInset,
  topInset = 0,
  renderBubble,
  counterpartyAvatar,
  historyExtras,
  kbStateExtras,
  onStartReached,
  onStartReachedThreshold,
}: ChatScreenProps) {
  const headerHeight = useHeaderHeight();
  const safeAreaInsets = useSafeAreaInsets();
  const surfaceColor = useThemeColor('surface');

  // `bottomInset` defaults to the bottom safe-area inset so the composer
  // clears the home indicator out of the box. The AI tab passes its own
  // inset (NativeTabs reports tab-bar + home-indicator together; the
  // SovranTabBar path passes an explicit 0 because the bar already absorbs
  // the home indicator). `undefined` is the "not provided" sentinel so an
  // explicit 0 is honored instead of falling through to `insets.bottom`.
  // `topInset` falls back to `insets.top` only when there's no nav header
  // above (since a real `headerHeight` already includes the status-bar
  // inset; doubling them up pushes content too far down).
  const resolvedBottomInset = bottomInset !== undefined ? bottomInset : safeAreaInsets.bottom;
  const resolvedTopInset = topInset > 0 ? topInset : headerHeight > 0 ? 0 : safeAreaInsets.top;

  const [draft, setDraft] = useState('');

  // Measured composer height. Used to pad the FlashList's content so the
  // newest bubble rests just above the composer's top edge while the
  // composer itself is absolutely positioned over the chat — older bubbles
  // slide *under* the composer's translucent glass on scroll-up (the
  // iMessage / Telegram bleed-under-input look).
  const [composerHeight, setComposerHeight] = useState(0);
  const handleComposerLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setComposerHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  };

  // Keyboard avoidance split across two mechanisms:
  //
  //   - Composer: wrapped in `<KeyboardStickyView />` from
  //     `react-native-keyboard-controller`, which slides the composer up to
  //     the keyboard top when focused and back to its laid-out position
  //     when dismissed.
  //
  //   - List: Reanimated `translateY` on the FlashList wrapper, same as
  //     AiChatScreen — physically translates the list up so items
  //     (which are positioned in absolute content coordinates inside
  //     FlashList) shift with the keyboard. Padding-based avoidance on the
  //     wrapper doesn't move the items (it just shrinks the viewport), so
  //     the conversation stays put and only the composer rides up.
  //
  //   - The wrapper has an explicit `backgroundColor: surfaceColor`. AiChatScreen
  //     gets away without one because it mounts a `<PatternBackground />` that
  //     paints the screen behind its transformed wrapper; without a solid
  //     backing under a transformed Reanimated layer, iOS 26 has been
  //     observed painting a soft backdrop material across the area the
  //     wrapper traversed during the keyboard animation — visible as a
  //     keyboard-height blur band that persists after dismissal. Giving
  //     the wrapper a solid backing matches the AiChatScreen condition.
  //
  // `keyboardHeight.value` is negative when the keyboard is shown (RNKC
  // convention: negative = up). The composer is handled by
  // `KeyboardStickyView`, so this style only drives the list lift.
  //
  // Uses `top` (layout property) rather than `transform: translateY`
  // (CALayer transform). `translateY` promoted the wrapper to its own
  // compositor layer, which iOS 26 was capturing a backdrop snapshot of
  // during keyboard dismissal — leaving a keyboard-height blur band
  // after the unfocus animation completed. `top` flows through Yoga
  // re-layout instead of CALayer compositing, so no snapshot. Costs a
  // little perf (re-layout per frame) but chat content is light.
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const listKeyboardLiftStyle = useAnimatedStyle(() => ({
    top: keyboardHeight.value,
  }));

  // Canonical chat.kav.keyboard_state / chat.list.history_change emits, so
  // every DM-like surface stays observable in the same dashboards as the AI
  // surface.
  useChatSurfacePerfLogger({
    log,
    surface,
    headerHeight,
    messages,
    historyExtras,
    kbStateExtras,
  });
  useChatKeyboardAnimationLogger({ log, surface });

  const groupingMap = useMessageGrouping(messages);

  const dispatchSend = useSingleFlight(async (text: string) => {
    const sendStart = performance.now();
    log.info('chat.send.dispatch', {
      surface,
      textLen: text.length,
      historyCount: messages.length,
    });
    try {
      await onSend(text);
      log.info('chat.send.complete', {
        surface,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
      });
    } catch (err) {
      log.warn('chat.send.failed', {
        surface,
        duration_ms: Math.round((performance.now() - sendStart) * 100) / 100,
        err,
      });
      throw err;
    }
  });

  const handleSubmit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void dispatchSend(text).catch(() => {
      // Errors already logged by dispatchSend; consumer's onSend is
      // expected to surface user-visible feedback (popups/banners).
    });
  };

  const renderItem = ({ item }: { item: ChatBubbleMessage; index: number }) => {
    const group = groupingMap.get(item.id);
    const isFirstInGroup = group?.isFirst ?? true;
    const isLastInGroup = group?.isLast ?? true;
    return (
      <RNView style={MESSAGE_ROW_STYLE}>
        {renderBubble ? (
          renderBubble({ message: item, isFirstInGroup, isLastInGroup })
        ) : (
          <ChatMessageBubble
            message={item}
            isFirstInGroup={isFirstInGroup}
            isLastInGroup={isLastInGroup}
            counterpartyAvatar={counterpartyAvatar}
          />
        )}
      </RNView>
    );
  };

  // Tap-to-dismiss-keyboard wrapper around the consumer-provided empty
  // placeholder. Mounted in place of the list when there are no messages;
  // the composer stays mounted on top, ready to accept the first send.
  const wrappedEmptyContent = emptyContent ? (
    <Pressable
      onPress={Keyboard.dismiss}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}
      accessible={false}
      importantForAccessibility="no">
      {emptyContent}
    </Pressable>
  ) : null;

  // Pad bottom of the list so the newest bubble rests just above the
  // composer's top edge. No `paddingTop` here: adding one breaks
  // `alignItemsAtEnd`'s "content < viewport → dock to bottom" math (the
  // contentContainer's own paddingTop counts toward effective content
  // height, so FlashList thinks the viewport is already filled and skips
  // the auto-bottom padding it would otherwise insert).
  // `resolvedTopInset` clearance against a transparent floating header is
  // already accounted for at the screen level by consumers that need it
  // (Screen primitive's `safeArea` / header inset handling).
  const listContentContainerStyle = {
    paddingBottom: composerHeight + resolvedBottomInset + 16,
  };

  return (
    <View style={{ backgroundColor: surfaceColor, flex: 1 }}>
      {/* Static absolute-fill backdrop behind every transformed child.
          AiChatScreen mounts a `<PatternBackground />` with the same
          `StyleSheet.absoluteFillObject` shape — without this sibling, the
          transformed Reanimated.View below was leaving an iOS 26 backdrop
          material snapshot after keyboard dismissal (visible as a
          keyboard-height blur band). Putting `backgroundColor` on the
          Reanimated.View itself doesn't work — iOS still perceives the
          transformed layer as "translucent moving content." A static
          absolute-fill sibling is what suppresses the snapshot. */}
      <RNView
        style={[StyleSheet.absoluteFillObject, { backgroundColor: surfaceColor }]}
        pointerEvents="none"
      />
      {banner}
      {isLoading ? (
        (loadingContent ?? null)
      ) : (
        <>
          {/* List wrapper. Layout-based keyboard lift (`top: -keyboardH`)
              shifts the whole wrapper up so FlashList's items — which it
              positions in absolute content coordinates — ride along.
              Padding-based avoidance only shrinks the viewport without
              moving items, and `translateY` creates a compositor-layer
              transform that iOS 26 captures backdrop snapshots of during
              keyboard dismissal. `top` is a Yoga property — no separate
              layer, no snapshot. */}
          <Reanimated.View
            style={[
              {
                flex: 1,
                paddingTop: resolvedTopInset,
              },
              listKeyboardLiftStyle,
            ]}>
            <RNView style={{ flex: 1 }}>
              {messages.length === 0 ? (
                <RNView style={{ flex: 1 }}>{wrappedEmptyContent}</RNView>
              ) : (
                <FlashList
                  data={messages}
                  keyExtractor={keyExtractor}
                  renderItem={renderItem}
                  // Chat-bottom behavior via FlashList v2's maintainVisibleContentPosition:
                  // - `startRenderingFromBottom` lands the first paint at the latest
                  //   message AND docks short histories to the bottom (replacing
                  //   FlashList's `initialScrollAtEnd` + `alignItemsAtEnd`).
                  // - `autoscrollToBottomThreshold` keeps the viewport pinned to the
                  //   latest when new messages append, as long as the user is near the
                  //   bottom (replacing `maintainScrollAtEnd` + threshold).
                  // mVCP also keeps the visible item anchored when items above the
                  // viewport resize/load late (bubble-height measurements, etc.).
                  maintainVisibleContentPosition={{
                    startRenderingFromBottom: true,
                    autoscrollToBottomThreshold: 0.1,
                  }}
                  showsVerticalScrollIndicator={false}
                  onStartReached={onStartReached}
                  onStartReachedThreshold={onStartReachedThreshold}
                  contentContainerStyle={listContentContainerStyle}
                />
              )}
            </RNView>
          </Reanimated.View>

          {/* Composer rides the keyboard via `<KeyboardStickyView />` from
              react-native-keyboard-controller — replaces the previous
              Reanimated `translateY` on a `position: 'absolute'` wrapper,
              which (combined with the list-wrapper transform) was painting
              an iOS 26 backdrop material across the keyboard region during
              dismissal. The View itself is absolutely positioned at
              `bottom: resolvedBottomInset` so the composer rests above the
              home indicator when the keyboard is closed; `KeyboardStickyView`
              slides it up to the keyboard top when focused and back to rest
              on dismiss. The list bubbles can scroll *under* its translucent
              glass instead of clipping at a hard cut-off. */}
          <KeyboardStickyView
            offset={{ closed: 0, opened: 0 }}
            style={{ position: 'absolute', left: 0, right: 0, bottom: resolvedBottomInset }}>
            <RNView onLayout={handleComposerLayout}>
              {composerActions ? (
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
                  {composerActions}
                </ScrollView>
              ) : null}
              <LiquidChatComposer
                value={draft}
                onChangeText={setDraft}
                onSend={handleSubmit}
                disabled={composerDisabled}
                placeholder={composerPlaceholder}
                onPlusPress={composerOnPlusPress}
                onVoicePress={composerOnVoicePress}
                bottomPadding={8}
                testID={composerTestID}
                surface={surface}
              />
            </RNView>
          </KeyboardStickyView>
        </>
      )}
    </View>
  );
}
