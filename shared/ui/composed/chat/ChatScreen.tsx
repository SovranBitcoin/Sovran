import React, { useCallback, useMemo, useState } from 'react';
import {
  ScrollView,
  useWindowDimensions,
  View as RNView,
  type LayoutChangeEvent,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GiftedChat, type IMessage, type InputToolbarProps } from 'react-native-gifted-chat';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

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
   * tab's NativeTabs). The composer is shifted up by this much, and the
   * GiftedChat list grows its content padding to match so the newest bubble
   * still rests just above the composer. When omitted, falls back to the
   * bottom safe-area inset so standalone surfaces (DMs) clear the home
   * indicator. An explicit `0` is honored — surfaces above a JS tab bar
   * that already absorbs the home indicator pass `0` so the composer sits
   * flush against the bar instead of floating above it.
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
}

const OWN_USER_ID = 'me';
/** Visual gap between the composer's outer bottom edge and the keyboard top
 *  when focused. Intentionally tighter than the closed-state gap (which is
 *  the bottom safe-area inset, ~34pt on iPhone) — the keyboard already
 *  provides plenty of breathing room above its keys, so a smaller gap reads
 *  as "the composer is sitting on the keyboard" instead of floating mid-air. */
const COMPOSER_FOCUSED_BOTTOM_GAP = 0;

type GiftedMessage = IMessage & { __bubble: ChatBubbleMessage };

/**
 * Shared chat surface backed by `react-native-gifted-chat`. The list,
 * keyboard avoidance, and inverted scroll behaviour come from GiftedChat;
 * `LiquidChatComposer` (mounted via `renderInputToolbar`) and
 * `ChatMessageBubble` (mounted via `renderMessage`) keep every consumer
 * (BitChat, WhiteNoise, Nostr DM, AI) visually consistent.
 *
 * Each surface is responsible for mapping its native event into
 * `ChatBubbleMessage[]`; everything below that is shared.
 */
export function ChatScreen({
  surface,
  log,
  header,
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
}: ChatScreenProps) {
  const headerHeight = useHeaderHeight();
  const { height: windowHeight } = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const surfaceColor = useThemeColor('surface');

  // ChatScreen owns its own safe-area handling so the KAV always measures a
  // full-screen frame and `keyboardVerticalOffset: 0` Just Works. Wrapping
  // ChatScreen in `<Screen safeArea>` (or any layer that pads the bottom by
  // the home-indicator inset) shifts the KAV's measured bottom up by that
  // amount, which makes the keyboard math undershoot — the composer ends up
  // flush against the keys with no breathing room. Use `<Screen scroll="none">`
  // (no `safeArea`) for chat surfaces.
  //
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

  // Measured composer height. Used to pad the FlatList's content so the
  // newest bubble rests just above the composer's top edge while the
  // composer itself is absolutely positioned over the chat — older bubbles
  // slide *under* the composer's translucent glass on scroll-up (the
  // iMessage / Telegram bleed-under-input look).
  const [composerHeight, setComposerHeight] = useState(0);
  const handleComposerLayout = useCallback((e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.height;
    setComposerHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
  }, []);

  // Whole chat surface (list + composer) rides the keyboard via a single
  // shared translate on a Reanimated wrapper around <GiftedChat>, mirroring
  // AiChatScreen. GiftedChat's built-in KAV is disabled below — relying on
  // `behavior: 'padding'` to lift the absolutely-positioned composer turned
  // out to be unreliable across border-box positioning and modal contexts
  // (some surfaces saw the composer pinned under the keyboard, others saw a
  // double lift). Driving the lift ourselves removes the ambiguity. Math:
  //
  //   translateY = keyboardHeight.value
  //              + keyboardProgress.value * (resolvedBottomInset - COMPOSER_FOCUSED_BOTTOM_GAP)
  //
  // `keyboardHeight.value` is negative when the keyboard is shown (RNKC
  // convention: negative translateY = up). At rest both terms are 0 and the
  // wrapper sits at its laid-out position. At fully open the wrapper moves up
  // by `keyboardHeight - resolvedBottomInset`, which lands the composer's
  // outer bottom edge flush with the keyboard top (since the composer sits
  // at `bottom: resolvedBottomInset` of the wrapper). The list (an inverted
  // FlatList inside the wrapper) rides along, so the newest bubble stays
  // just above the composer instead of getting hidden behind the keyboard.
  const { progress: keyboardProgress, height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const keyboardLiftStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          keyboardHeight.value +
          keyboardProgress.value * (resolvedBottomInset - COMPOSER_FOCUSED_BOTTOM_GAP),
      },
    ],
  }));

  // Canonical chat.kav.keyboard_state / chat.list.history_change emits.
  // List-layout / scroll handlers aren't wired because GiftedChat's
  // FlatList doesn't expose those hooks publicly.
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

  // GiftedChat expects newest-first; source array is oldest-first. Stash
  // the original `ChatBubbleMessage` on `__bubble` so renderMessage can
  // hand it back to the bubble component without re-deriving anything.
  const giftedMessages = useMemo<GiftedMessage[]>(() => {
    const out: GiftedMessage[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      out.push({
        _id: m.id,
        text: m.content,
        createdAt: m.timestamp,
        user: { _id: m.isOwn ? OWN_USER_ID : m.senderId || 'peer', name: m.sender },
        __bubble: m,
      });
    }
    return out;
  }, [messages]);

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

  const handleSubmit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void dispatchSend(text).catch(() => {
      // Errors already logged by dispatchSend; consumer's onSend is
      // expected to surface user-visible feedback (popups/banners).
    });
  }, [draft, dispatchSend]);

  // Composer is absolute over the chat body so messages can scroll *under*
  // its translucent glass instead of clipping at a hard cut-off. The
  // wrapper has no backgroundColor of its own — only the
  // LiquidChatComposer's inner glass capsules do — so messages bleed
  // through the gaps. Optional action row sits inside the same wrapper so
  // it rides the keyboard animation in lock-step with the input bubble.
  const renderInputToolbar = useCallback(
    (_props: InputToolbarProps<GiftedMessage>) => (
      // No `transform` here — the outer Reanimated.View wrapping <GiftedChat>
      // owns the keyboard lift. Composer just anchors statically at
      // `bottom: resolvedBottomInset` of that wrapper and rides along.
      <RNView
        onLayout={handleComposerLayout}
        style={{ position: 'absolute', left: 0, right: 0, bottom: resolvedBottomInset }}>
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
          // Modal-stack chat surfaces (DMs / geohash / Whitenoise) don't sit
          // above a tab bar, so the bubble lands close to the keyboard top
          // when focused. Bump bottomPadding above the default 12 to give
          // the bubble breathing room over the keyboard and the home indicator.
          bottomPadding={8}
          testID={composerTestID}
          surface={surface}
        />
      </RNView>
    ),
    [
      draft,
      handleSubmit,
      handleComposerLayout,
      composerActions,
      composerDisabled,
      composerPlaceholder,
      composerOnPlusPress,
      composerOnVoicePress,
      composerTestID,
      surface,
      resolvedBottomInset,
    ]
  );

  // Reach into `__bubble` for the original `ChatBubbleMessage` so grouping
  // + cashu-token + delivery-status logic stays untouched. Surfaces that
  // need a different bubble shape (AI's bubble-less assistant) provide
  // `renderBubble` and we hand them the same grouping metadata.
  const renderMessage = useCallback(
    ({ currentMessage }: { currentMessage: GiftedMessage }) => {
      const bubble = currentMessage.__bubble;
      const group = groupingMap.get(bubble.id);
      const isFirstInGroup = group?.isFirst ?? true;
      const isLastInGroup = group?.isLast ?? true;
      return (
        <RNView style={{ paddingHorizontal: 16 }}>
          {renderBubble ? (
            renderBubble({ message: bubble, isFirstInGroup, isLastInGroup })
          ) : (
            <ChatMessageBubble
              message={bubble}
              isFirstInGroup={isFirstInGroup}
              isLastInGroup={isLastInGroup}
              counterpartyAvatar={counterpartyAvatar}
            />
          )}
        </RNView>
      );
    },
    [groupingMap, counterpartyAvatar, renderBubble]
  );

  // Inverted FlatList applies `transform: scaleY(-1)` to its empty slot;
  // counter-rotate so the placeholder isn't upside-down. Mounted alongside
  // the composer so the user can start typing without an explicit branch
  // in the surface above.
  const renderChatEmpty = useCallback(
    () =>
      emptyContent ? (
        <RNView
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            transform: [{ scaleY: -1 }],
          }}>
          {emptyContent}
        </RNView>
      ) : null,
    [emptyContent]
  );

  return (
    <View style={{ backgroundColor: surfaceColor, flex: 1 }}>
      {banner}
      {isLoading ? (
        (loadingContent ?? null)
      ) : (
        <Reanimated.View style={[{ flex: 1 }, keyboardLiftStyle]}>
          <GiftedChat<GiftedMessage>
            messages={giftedMessages}
            messagesContainerStyle={{
              height: 400,
            }}
            user={{ _id: OWN_USER_ID }}
            renderInputToolbar={renderInputToolbar}
            renderMessage={renderMessage}
            renderChatEmpty={renderChatEmpty}
            renderAvatar={null}
            renderDay={() => null}
            renderTime={() => null}
            renderUsername={() => null}
            isUsernameVisible={false}
            isDayAnimationEnabled={false}
            minInputToolbarHeight={0}
            messageIdGenerator={() => `gc-${Date.now()}`}
            listProps={{
              // Transparent so our outer `surfaceColor` shows through —
              // iOS FlatList defaults to `systemBackground` (≈ #1C1C1E
              // in dark mode), which leaks a tinted rectangle behind
              // bubble-less renderers like the AI assistant text.
              style: { flex: 1, backgroundColor: 'transparent' },
              // iOS 13+ defaults to `contentInsetAdjustmentBehavior:
              // 'automatic'`, which makes UIScrollView push content out
              // from under translucent navigation/tab bars AND apply a
              // vibrancy material to the area "behind" them. Our list
              // is `inverted`; UIKit doesn't know about the scaleY
              // transform, so it applies the vibrancy zone to the
              // wrong half. We layer our own padding via
              // `topInset` / `bottomInset`, so opting out is safe.
              contentInsetAdjustmentBehavior: 'never',
              // Auto-adjust gives us the right *bottom* inset out of the
              // box (lifts the indicator above the home indicator / tab
              // bar so it aligns with the composer top). On the top side,
              // UIKit adds a header inset even though our wrapper is
              // already sized to `windowHeight - headerHeight` and the
              // FlatList's true top edge is below the Stack header — so
              // we pass a negative `top` to cancel out exactly that
              // double-count. iOS adds `scrollIndicatorInsets` on top of
              // the auto-adjusted ones, so a negative value here
              // subtracts from the auto inset and lands the indicator's
              // top right at the FlatList's actual edge.
              automaticallyAdjustsScrollIndicatorInsets: true,
              scrollIndicatorInsets: { top: 0, bottom: 0, left: 0, right: 0 },
              // Inverted list: `paddingTop` = visual BOTTOM clearance,
              // `paddingBottom` = visual TOP clearance. Padding the
              // contentContainer (rather than wrapping the list in a
              // padded View) keeps the FlatList full-screen, so
              // bubbles bleed under the floating header / composer
              // during scroll but settle at the right edges at rest.
              //
              // No magic-number breathing room on the top edge: when a
              // header is present, `resolvedTopInset` is 0 and the
              // header's own bottom edge gives the visual separation.
              // When there's no header, `resolvedTopInset === insets.top`
              // and the topmost bubble already clears the status bar.
              // Adding extra px here just makes the rest position float
              // lower than it should.
              contentContainerStyle: {
                paddingTop: composerHeight + resolvedBottomInset + 16,
                paddingBottom: resolvedTopInset,
              },
            }}
            // GiftedChat's internal KAV is disabled — the outer Reanimated.View
            // around <GiftedChat> drives the keyboard lift for both the list and
            // the composer in lock-step. Mixing the KAV's padding-based lift
            // with our translate produced either no lift (composer pinned under
            // the keyboard) or double-lift (composer floating well above it),
            // depending on whether RN resolves `position:'absolute'; bottom:X`
            // against the border or padding box in the current context. Owning
            // the lift on our side removes that ambiguity and also makes the
            // math identical across full-screen surfaces and modal-stack ones.
            keyboardAvoidingViewProps={{ enabled: false }}
            onSend={() => {}}
          />
        </Reanimated.View>
      )}
    </View>
  );
}
