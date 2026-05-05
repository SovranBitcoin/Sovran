import React, { useCallback, useId, useRef, useState } from 'react';
import {
  Platform,
  TextInput,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Spacer as SwiftUISpacer,
  Namespace,
  GlassEffectContainer,
} from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  buttonStyle,
  disabled as disabledModifier,
  frame,
  glassEffectId,
  opacity as swiftOpacity,
  scaleEffect,
} from '@expo/ui/swift-ui/modifiers';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { supportsLiquidGlass } from '@/shared/lib/version';
import { chatLog } from '@/shared/lib/logger';

interface LiquidChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Tap handler for the leading [+] glass button. The glyph is fixed
   * (`mdi:plus`) — the action varies per surface (UserMessages can open an
   * attachment picker; BitChat / WhiteNoise can attach a Cashu token, etc.).
   * When omitted the button still renders so the visual stays consistent
   * across surfaces, but pressing it is a no-op.
   */
  onPlusPress?: () => void;
  /**
   * Tap handler for the money icon rendered INSIDE the input on the right
   * (only visible while the input is empty). Hidden when undefined — e.g.
   * BitChat ble-dm has no Lightning identity for the peer so the affordance
   * is omitted.
   */
  onMoneyPress?: () => void;
  /**
   * Tap handler for the voice icon rendered INSIDE the input. Currently a
   * placeholder for future voice messaging — no surface implements it yet.
   * Hidden when undefined.
   */
  onVoicePress?: () => void;
  /** Bottom padding below the bubble. Defaults to 12 (matches horizontal margin). */
  bottomPadding?: number;
  testID?: string;
  /** log-doctor surface tag, threaded into `chat.composer.*` events. */
  surface?: string;
}

const BUTTON_SIZE = 44;
const ICON_SIZE = 20;
const GAP = 10;
/**
 * Spring tuned to match SwiftUI's `.bouncy(duration: 0.4, extraBounce: 0.15)`.
 * `bounce: 0.45` is the iOS-17+ name for the spring's overshoot, which is
 * what produces the "appears small and grows" feel on the trailing send
 * button. A heavily-damped spring (`dampingFraction: 0.8`, ≈ `.smooth`)
 * lands without any overshoot, which is why the previous version felt flat.
 */
const SEND_SPRING = Animation.spring({ duration: 0.4, bounce: 0.45 });
/** Vertical padding inside the input bubble (top + bottom together). */
const INPUT_VPAD = 12;
/** Floor for the row height — keeps the input the same height as the
 *  buttons when the TextInput is empty / single-line. */
const MIN_ROW_HEIGHT = BUTTON_SIZE;
const MAX_ROW_HEIGHT = 140;

/**
 * Liquid-glass DM-surface composer. Three glass shapes laid out
 * left-to-right — leading [+] circle, middle text input capsule,
 * trailing [→] circle (visible only while the input has content).
 * Plain regular-glass material on all three (no tint) — tinting the
 * material colorizes the entire shape, which gives Apple's stock
 * messaging composer its washed-out look. Money + voice icons render
 * inside the input on the right while the input is empty.
 *
 * On iOS 26+ all three glass shapes live inside a single SwiftUI `Host`
 * wrapped in `Namespace` + `GlassEffectContainer`, with `glassEffectId`
 * per shape. SwiftUI animates the morph automatically when the trailing
 * [→] mounts/unmounts on text-empty toggles. The RN `TextInput` overlays
 * the middle region only — taps in the button regions fall through to
 * the SwiftUI buttons below.
 *
 * Older iOS / Android fall back to the standard `<View blur />` primitive
 * (no morph; buttons are RN Pressables).
 *
 * Used by the bitchat / nostr-DM / whitenoise screens via `ChatScreen`.
 * The AI tab mounts `ChatComposer` directly and is intentionally not
 * affected by this design.
 */
export function LiquidChatComposer({
  value,
  onChangeText,
  onSend,
  disabled,
  placeholder = 'Write here',
  onPlusPress,
  onMoneyPress,
  onVoicePress,
  bottomPadding = 12,
  testID,
  surface,
}: LiquidChatComposerProps) {
  const [foreground, surfaceTertiary, shade400, shade500] = useThemeColor([
    'foreground',
    'surface-tertiary',
    'shade-400',
    'shade-500',
  ] as const);

  const trimmedHasText = value.trim().length > 0;
  const canSend = trimmedHasText && !disabled;
  const isEmpty = value.length === 0;
  const useNativeGlass = Platform.OS === 'ios' && supportsLiquidGlass();

  // Stable namespace id — required by SwiftUI's `glassEffectId(_:in:)` so
  // the system can match shapes across renders and animate the morph.
  // `useId` gives one per component instance; remounts get a fresh id,
  // which is exactly what we want.
  const namespaceId = useId();

  // Content-driven height: the multiline `TextInput` reports its intrinsic
  // height via `onContentSizeChange`. Empty input ≈ one line — we clamp to
  // `MIN_ROW_HEIGHT` so the input bubble matches the button height. Filled
  // input grows up to `MAX_ROW_HEIGHT`. Without this the wrapper used
  // `minHeight: 44` and the multiline default intrinsic height drew the
  // bubble TALLER than the buttons.
  const [contentHeight, setContentHeight] = useState(0);
  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const h = e.nativeEvent.contentSize.height;
      // Round to nearest pt to avoid sub-pixel re-layout loops on iOS.
      setContentHeight(Math.round(h));
    },
    []
  );
  const rowHeight = Math.min(Math.max(contentHeight + INPUT_VPAD, MIN_ROW_HEIGHT), MAX_ROW_HEIGHT);

  const textInputRef = useRef<TextInput>(null);
  const focusTextInput = useCallback(() => {
    textInputRef.current?.focus();
  }, []);

  const lastLayoutRef = useRef<{ height: number; width: number } | null>(null);
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      const last = lastLayoutRef.current;
      const changed =
        !last || Math.abs(last.height - height) >= 0.5 || Math.abs(last.width - width) >= 0.5;
      if (!changed) return;
      lastLayoutRef.current = { height, width };
      chatLog.debug('chat.composer.layout', {
        surface: surface ?? 'unknown',
        width: Math.round(width),
        height: Math.round(height),
        hasText: trimmedHasText,
      });
    },
    [surface, trimmedHasText]
  );

  const handleSendPress = useCallback(() => {
    chatLog.info('chat.composer.send_tap', {
      surface: surface ?? 'unknown',
      textLen: value.length,
      disabled,
    });
    onSend();
  }, [surface, value.length, disabled, onSend]);

  const handlePlusPress = useCallback(() => {
    chatLog.info('chat.composer.plus_tap', { surface: surface ?? 'unknown' });
    onPlusPress?.();
  }, [surface, onPlusPress]);

  const insideIcons =
    isEmpty && (onMoneyPress || onVoicePress) ? (
      <HStack align="center" spacing={8} style={{ paddingRight: 4 }}>
        {onMoneyPress ? (
          <Pressable
            onPress={onMoneyPress}
            hitSlop={6}
            accessibilityLabel="Send money"
            testID={testID ? `${testID}-money` : undefined}>
            <Icon name="mingcute:lightning-fill" size={20} color={shade400} />
          </Pressable>
        ) : null}
        {onVoicePress ? (
          <Pressable
            onPress={onVoicePress}
            hitSlop={6}
            accessibilityLabel="Voice message"
            testID={testID ? `${testID}-voice` : undefined}>
            <Icon name="mdi:microphone" size={20} color={shade400} />
          </Pressable>
        ) : null}
      </HStack>
    ) : null;

  // Visible TextInput + inside icons. `pointerEvents="box-none"` on the
  // wrapper lets taps in the [+] / [→] regions (which sit OUTSIDE this
  // wrapper's bounds via `left` / `right` insets) fall through to the
  // SwiftUI buttons in the Host below.
  const renderRnOverlay = () => (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: BUTTON_SIZE + GAP,
        right: trimmedHasText ? BUTTON_SIZE + GAP : 0,
      }}>
      <HStack align="center" spacing={8} style={{ flex: 1, paddingHorizontal: 16 }}>
        <TextInput
          ref={textInputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={shade500}
          editable={!disabled}
          multiline
          maxLength={1000}
          returnKeyType="send"
          onSubmitEditing={handleSendPress}
          onContentSizeChange={handleContentSizeChange}
          style={{
            flex: 1,
            color: foreground,
            fontSize: 16,
            lineHeight: 22,
            padding: 0,
            margin: 0,
          }}
          testID={testID}
        />
        {insideIcons}
      </HStack>
    </View>
  );

  if (useNativeGlass) {
    return (
      <View
        onLayout={handleLayout}
        style={{
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: bottomPadding,
        }}>
        <View style={{ height: rowHeight, position: 'relative' }}>
          {/* SwiftUI side: all three glass shapes in one Host, wrapped in
              Namespace + GlassEffectContainer with glassEffectId per shape
              so the system animates the morph when the [→] mounts /
              unmounts. */}
          <Host
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            matchContents={false}>
            <Namespace id={namespaceId}>
              {/* `spacing` is the *merge threshold* — when the nearest edges
                  of two glass shapes sit closer than `spacing`, the system
                  blends them into one liquid-metaball blob. Setting it to 0
                  keeps the [+] / input / [→] visually separated in steady
                  state. The bounce-in / morph still animates because that's
                  driven by `glassEffectId` (matched-geometry), not by the
                  blend threshold. A non-zero `spacing` is what produced the
                  permanent gooey bridges between the three shapes in the
                  earlier rev — the HStack gap (8pt) was less than the 20pt
                  threshold, so they were always inside the merge zone. */}
              <GlassEffectContainer spacing={0}>
                <SwiftUIHStack
                  alignment="bottom"
                  spacing={GAP}
                  modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
                  {/* Leading [+] glass button. The animation modifier is
                      attached to every glass child watching the same boolean
                      so they all re-evaluate inside the same animated
                      transaction — this is the @expo/ui equivalent of
                      SwiftUI's `withAnimation { state.toggle() }` since the
                      JS-side state change can't span an animation block on
                      its own. */}
                  <SwiftUIButton
                    modifiers={[
                      // `buttonStyle('glass')` provides BOTH the visible
                      // glass material AND the built-in liquid press / morph
                      // animation. Stacking an explicit `glassEffect()`
                      // modifier on top draws a second concentric glass
                      // ring (visible on press as a doubled circle) and
                      // overrides the implicit animation, so we don't.
                      // `glassEffectId` still works alongside the button
                      // style — it just registers the matched-geometry id
                      // in the surrounding Namespace.
                      buttonStyle('glass'),
                      frame({ width: BUTTON_SIZE, height: BUTTON_SIZE }),
                      glassEffectId('plus', namespaceId),
                      animation(SEND_SPRING, trimmedHasText),
                    ]}
                    onPress={disabled ? () => {} : handlePlusPress}>
                    <SwiftUIHStack
                      alignment="center"
                      modifiers={[
                        frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
                      ]}>
                      <SwiftUIImage systemName={'plus' as never} size={ICON_SIZE} color="#FFFFFF" />
                    </SwiftUIHStack>
                  </SwiftUIButton>

                  {/* Middle input — also a `buttonStyle('glass')` button
                      so the same press animation as [+] / [→] fires when
                      the user taps the bubble's padding edges (taps inside
                      the TextInput's visible area still focus directly via
                      RN; both paths land at "input is focused" since the
                      button's onPress focuses the TextInput via ref). The
                      inner HStack with `frame(maxWidth/maxHeight: Infinity)`
                      is load-bearing — without an inner view that fills,
                      Apple's glass button style collapses to its content's
                      intrinsic size and the bubble renders as a tiny pill. */}
                  <SwiftUIButton
                    modifiers={[
                      buttonStyle('glass'),
                      frame({ maxWidth: Infinity, height: rowHeight }),
                      glassEffectId('input', namespaceId),
                      animation(SEND_SPRING, trimmedHasText),
                    ]}
                    onPress={focusTextInput}>
                    <SwiftUIHStack modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
                      <SwiftUISpacer />
                    </SwiftUIHStack>
                  </SwiftUIButton>

                  {/* Trailing [→] glass button. ALWAYS rendered — toggling
                      its presence via React unmount bypasses SwiftUI's
                      animation transaction and you get a hard pop instead
                      of the bounce-in. Instead we collapse it to width=0,
                      scale=0, opacity=0 when the input is empty, and let
                      the bouncy spring (`bounce: 0.45`) drive the scale +
                      width interpolation so the button "appears small and
                      gets bigger" the way Apple's Messages composer does.
                      The matched-geometry seam to the input capsule comes
                      from sharing a GlassEffectContainer + glassEffectId
                      namespace; the `disabledModifier` blocks taps while
                      the button is collapsed. */}
                  <SwiftUIButton
                    modifiers={[
                      // `plain` strips SwiftUI's default button styling so
                      // See [+] above — `buttonStyle('glass')` owns the
                      // visual + native animation; we don't stack an
                      // explicit `glassEffect()` on top.
                      buttonStyle('glass'),
                      frame({
                        width: trimmedHasText ? BUTTON_SIZE : 0,
                        height: BUTTON_SIZE,
                      }),
                      scaleEffect(trimmedHasText ? 1 : 0),
                      swiftOpacity(trimmedHasText ? 1 : 0),
                      glassEffectId('send', namespaceId),
                      disabledModifier(!canSend),
                      animation(SEND_SPRING, trimmedHasText),
                    ]}
                    onPress={canSend ? handleSendPress : () => {}}>
                    <SwiftUIHStack
                      alignment="center"
                      modifiers={[
                        frame({
                          maxWidth: Infinity,
                          maxHeight: Infinity,
                          alignment: 'center',
                        }),
                      ]}>
                      <SwiftUIImage
                        systemName={'arrow.up' as never}
                        size={ICON_SIZE}
                        color="#FFFFFF"
                      />
                    </SwiftUIHStack>
                  </SwiftUIButton>
                </SwiftUIHStack>
              </GlassEffectContainer>
            </Namespace>
          </Host>

          {renderRnOverlay()}
        </View>
      </View>
    );
  }

  // Fallback — three RN Pressables/Views with the existing blur primitive.
  // No SwiftUI morph here; the [→] simply mounts/unmounts.
  return (
    <View
      onLayout={handleLayout}
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: bottomPadding,
      }}>
      <HStack align="flex-end" spacing={GAP}>
        <Pressable
          onPress={disabled ? undefined : handlePlusPress}
          disabled={disabled}
          accessibilityLabel="Composer actions"
          accessibilityRole="button">
          <View
            blur
            blurIntensity={60}
            blurTint="prominent"
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              borderRadius: BUTTON_SIZE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
            <Icon name="mdi:plus" size={ICON_SIZE} color="#FFFFFF" />
          </View>
        </Pressable>

        <View
          style={{
            flex: 1,
            height: rowHeight,
            position: 'relative',
            justifyContent: 'center',
          }}>
          <View
            pointerEvents="none"
            blur
            blurIntensity={60}
            blurTint="prominent"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: rowHeight / 2,
              overflow: 'hidden',
              backgroundColor: surfaceTertiary,
            }}
          />
          <HStack align="center" spacing={8} style={{ paddingHorizontal: 16 }}>
            <TextInput
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={shade500}
              editable={!disabled}
              multiline
              maxLength={1000}
              returnKeyType="send"
              onSubmitEditing={handleSendPress}
              onContentSizeChange={handleContentSizeChange}
              style={{
                flex: 1,
                color: foreground,
                fontSize: 16,
                lineHeight: 22,
                padding: 0,
                margin: 0,
              }}
              testID={testID}
            />
            {insideIcons}
          </HStack>
        </View>

        {trimmedHasText ? (
          <Pressable
            onPress={canSend ? handleSendPress : undefined}
            disabled={!canSend}
            accessibilityLabel="Send message"
            accessibilityRole="button"
            testID={testID ? `${testID}-send` : undefined}>
            <View
              blur
              blurIntensity={60}
              blurTint="prominent"
              style={{
                width: BUTTON_SIZE,
                height: BUTTON_SIZE,
                borderRadius: BUTTON_SIZE / 2,
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}>
              <Icon name="iconamoon:send-fill" size={ICON_SIZE} color="#FFFFFF" />
            </View>
          </Pressable>
        ) : null}
      </HStack>
    </View>
  );
}
