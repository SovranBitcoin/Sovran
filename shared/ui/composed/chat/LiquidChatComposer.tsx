import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
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
  TextField as SwiftUITextField,
  type TextFieldRef,
  Namespace,
  GlassEffectContainer,
} from '@expo/ui/swift-ui';
import {
  Animation,
  animation,
  autocorrectionDisabled as swiftAutocorrectionDisabled,
  buttonStyle,
  contentShape,
  disabled as disabledModifier,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  glassEffectId,
  onSubmit as onSubmitModifier,
  onTapGesture,
  opacity as swiftOpacity,
  padding,
  scaleEffect,
  shapes,
  submitLabel,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCapabilities } from '@/shared/ui/capability';
import { chatLog } from '@/shared/lib/logger';

interface LiquidChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  /**
   * Tap handler for the leading [+] glass button. The glyph is fixed
   * (`mdi:plus` / SF `plus`) — the action varies per surface (UserMessages
   * can open an attachment picker; BitChat / WhiteNoise can attach a Cashu
   * token, etc.). When omitted the button still renders so the visual stays
   * consistent across surfaces, but pressing it is a no-op.
   */
  onPlusPress?: () => void;
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
 * lands without any overshoot, which is why earlier revs felt flat.
 */
const SEND_SPRING = Animation.spring({ duration: 0.4, bounce: 0.45 });

// Fallback-only constants. The SwiftUI `TextField` handles its own intrinsic
// sizing, so the iOS 26+ path doesn't need a content-driven row height — the
// bubble is fixed at `BUTTON_SIZE` (single-line input). Multi-line growth on
// the SwiftUI path can be added later via `axis="vertical"` + `lineLimit` and
// switching the Host to `matchContents`.
const INPUT_VPAD = 12;
const MIN_ROW_HEIGHT = BUTTON_SIZE;
const MAX_ROW_HEIGHT = 140;

/**
 * Liquid-glass DM-surface composer. Three glass shapes laid out
 * left-to-right — leading [+] circle, middle text input capsule,
 * trailing [→] circle (visible only while the input has content).
 *
 * **iOS 26+ path** is pure SwiftUI: the input bubble is a real
 * `SwiftUI.TextField` rendered inside the same `Host` as the [+] / [→]
 * buttons, all wrapped in `Namespace` + `GlassEffectContainer` so the
 * morph between empty and "has text" animates via matched-geometry. No
 * RN `TextInput` overlay, no row-height feedback loop, no placeholder
 * baseline mismatch — SwiftUI handles its own placeholder rendering,
 * focus, and submit. Padding-edge taps focus the field via a capsule
 * `contentShape` + `onTapGesture` on the bubble.
 *
 * The SwiftUI `TextField` is *uncontrolled* (it reads `defaultValue`
 * only at mount). To keep it in sync with the parent's `value` prop we
 * watch for divergence between the prop and the last value SwiftUI
 * reported, and bump a `key` to remount the field on external clears
 * (typically: parent calls `onSend` then resets `value` to `''`).
 *
 * **Older iOS / Android** fall back to an RN multiline `TextInput`
 * overlaid on a `View blur` capsule. No glass morph; [→] simply
 * mounts/unmounts. The fallback keeps its content-driven row height
 * because RN's `TextInput` has no intrinsic vertical sizing without it.
 *
 * Used by every chat surface (BitChat, Nostr DM, WhiteNoise, AI) via
 * `ChatScreen`, which mounts this composer inside its `renderInputToolbar`.
 */
export function LiquidChatComposer({
  value,
  onChangeText,
  onSend,
  disabled,
  placeholder = 'Write here',
  onPlusPress,
  onVoicePress,
  bottomPadding = 12,
  testID,
  surface,
}: LiquidChatComposerProps) {
  // field-placeholder (NOT the shade ramp): shade-400/500 are the STATIC
  // brand-blue ramp, which made 'Ask anything'/'Write here' placeholders and
  // the mic icon read as accent-colored on the fallback tier.
  const [foreground, background, surfaceSecondary, fieldPlaceholder] = useThemeColor([
    'foreground',
    'background',
    'surface-secondary',
    'field-placeholder',
  ] as const);

  const trimmedHasText = value.trim().length > 0;
  const canSend = trimmedHasText && !disabled;
  const isEmpty = value.length === 0;
  const { liquidGlass: useNativeGlass } = useCapabilities();

  // Stable namespace id for `glassEffectId(_:in:)` matched-geometry. `useId`
  // gives one per component instance; a fresh id on remount is the desired
  // behavior (no morph carry-over between mounts).
  const namespaceId = useId();

  // SwiftUI `TextField` sync. The native field is uncontrolled — it reads
  // `defaultValue` only at mount and reports edits via `onValueChange`. We
  // mirror its current text in a ref and bump `resetKey` whenever the prop
  // diverges from the last reported value, which remounts the field with a
  // fresh `defaultValue`. Internal keystrokes update the ref synchronously
  // before the `onChangeText` round-trip lands, so the resulting prop
  // change is a no-op (`value === lastSwiftValueRef.current`) and the key
  // doesn't bump on every character.
  const lastSwiftValueRef = useRef(value);
  const [resetKey, setResetKey] = useState(0);
  useEffect(() => {
    if (value !== lastSwiftValueRef.current) {
      lastSwiftValueRef.current = value;
      setResetKey((k) => k + 1);
    }
  }, [value]);
  const handleSwiftValueChange = useCallback(
    (text: string) => {
      lastSwiftValueRef.current = text;
      onChangeText(text);
    },
    [onChangeText]
  );

  // Imperative ref so taps on the capsule's padding edges (outside the
  // TextField's intrinsic content rect) can focus the field — see the
  // `onTapGesture(focusTextField)` on the bubble below.
  const textFieldRef = useRef<TextFieldRef>(null);
  const focusTextField = useCallback(() => {
    void textFieldRef.current?.focus();
  }, []);

  // Fallback-only state: the RN multiline `TextInput` reports its intrinsic
  // height via `onContentSizeChange`. We clamp to `MIN_ROW_HEIGHT` so the
  // bubble matches the buttons when empty / single-line, and cap at
  // `MAX_ROW_HEIGHT` for very long input. The SwiftUI path doesn't use this.
  const [contentHeight, setContentHeight] = useState(0);
  const handleContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      setContentHeight(Math.round(e.nativeEvent.contentSize.height));
    },
    []
  );
  const fallbackRowHeight = Math.min(
    Math.max(contentHeight + INPUT_VPAD, MIN_ROW_HEIGHT),
    MAX_ROW_HEIGHT
  );

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

  if (useNativeGlass) {
    return (
      <View
        onLayout={handleLayout}
        style={{
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: bottomPadding,
        }}>
        <Host
          style={{ width: '100%', height: BUTTON_SIZE }}
          matchContents={false}
          // §7a: stop the SwiftUI hosting controller from applying its own
          // keyboard safe-area inset. RN keyboard-controller now drives the
          // composer position from the JS side via KeyboardStickyView; if
          // SwiftUI also avoids the keyboard the composer double-jumps.
          ignoreSafeArea="keyboard">
          <Namespace id={namespaceId}>
            {/* `spacing={0}` is the glass *merge threshold* — when the
                nearest edges of two glass shapes are closer than this, the
                system blends them into a single liquid-metaball blob. We
                want the [+] / input / [→] visually distinct in steady
                state, so spacing=0; the bounce-in / morph still animates
                because that's driven by `glassEffectId` matched-geometry,
                not by the blend threshold. */}
            <GlassEffectContainer spacing={0}>
              <SwiftUIHStack
                alignment="center"
                spacing={GAP}
                modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
                {/* Leading [+] glass button. `buttonStyle('glass')` provides
                    BOTH the visible glass material AND the built-in liquid
                    press animation — stacking an explicit `glassEffect()`
                    on top draws a doubled concentric ring on press, so we
                    don't. The shared `animation(SEND_SPRING, trimmedHasText)`
                    on every glass child re-evaluates inside one transaction
                    when the boolean flips, which is the @expo/ui equivalent
                    of `withAnimation { state.toggle() }` in SwiftUI. */}
                <SwiftUIButton
                  modifiers={[
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
                    <SwiftUIImage systemName={'plus' as never} size={ICON_SIZE} color={INVARIANT_WHITE} />
                  </SwiftUIHStack>
                </SwiftUIButton>

                {/* Middle input — glass capsule HStack containing a real
                    SwiftUI `TextField`. The capsule itself is NOT a button:
                    `buttonStyle('glass')` adds intrinsic padding around its
                    content that won't compress when the frame width is
                    flexible, which previously blew the bubble up to ~110pt.
                    `glassEffect()` directly on the HStack gives us the same
                    material with the frame `height: BUTTON_SIZE` honored,
                    and `glass.interactive: true` opts the shape into Apple's
                    liquid press feedback — the exact same morph animation
                    `buttonStyle('glass')` runs internally — without the
                    button-style sizing semantics. Padding-edge taps focus
                    the field via `contentShape` + `onTapGesture` (without
                    `contentShape` only the visible glyph areas would be
                    hit-testable). */}
                <SwiftUIHStack
                  alignment="center"
                  spacing={6}
                  modifiers={[
                    frame({ maxWidth: Infinity, height: BUTTON_SIZE, alignment: 'center' }),
                    glassEffect({
                      shape: 'capsule',
                      glass: { variant: 'regular', interactive: true },
                    }),
                    glassEffectId('input', namespaceId),
                    contentShape(shapes.capsule()),
                    onTapGesture(focusTextField),
                    animation(SEND_SPRING, trimmedHasText),
                  ]}>
                  <SwiftUITextField
                    key={resetKey}
                    ref={textFieldRef}
                    defaultValue={value}
                    placeholder={placeholder}
                    onValueChange={handleSwiftValueChange}
                    axis="horizontal"
                    modifiers={[
                      frame({ maxWidth: Infinity, alignment: 'leading' }),
                      padding({ leading: 16, trailing: 4 }),
                      foregroundStyle(foreground),
                      font({ size: 16 }),
                      submitLabel('send'),
                      onSubmitModifier(handleSendPress),
                      swiftAutocorrectionDisabled(false),
                      textInputAutocapitalization('sentences'),
                      disabledModifier(!!disabled),
                    ]}
                  />

                  {/* Inline voice affordance, only while empty. Conditional
                      unmount is fine here — not part of the matched-geometry
                      namespace, so there's no glass morph to break.
                      `buttonStyle('plain')` strips the default tint/halo so
                      the SF symbol sits flush. */}
                  {isEmpty && onVoicePress ? (
                    <SwiftUIButton
                      modifiers={[buttonStyle('plain'), padding({ trailing: 12 })]}
                      onPress={onVoicePress}>
                      <SwiftUIImage
                        systemName={'mic.fill' as never}
                        size={ICON_SIZE}
                        color={fieldPlaceholder}
                      />
                    </SwiftUIButton>
                  ) : null}
                </SwiftUIHStack>

                {/* Trailing [→] glass button. ALWAYS rendered — toggling
                    its presence via React unmount bypasses SwiftUI's
                    animation transaction and produces a hard pop. Instead
                    collapse to width=0 + scale=0 + opacity=0 when empty
                    and let the bouncy spring drive the interpolation, so
                    the button "appears small and gets bigger" the way
                    Apple's Messages composer does. The matched-geometry
                    seam to the input capsule comes from sharing the
                    GlassEffectContainer + glassEffectId namespace. */}
                <SwiftUIButton
                  modifiers={[
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
                      color={INVARIANT_WHITE}
                    />
                  </SwiftUIHStack>
                </SwiftUIButton>
              </SwiftUIHStack>
            </GlassEffectContainer>
          </Namespace>
        </Host>
      </View>
    );
  }

  // Fallback — iOS (<26) keeps real frosted-glass blur; Android gets the flat
  // contract (surface-secondary fills, no blur — expo-blur there reads as a
  // muddy tint). The [→] springs in/out via reanimated. The RN multiline
  // TextInput drives `fallbackRowHeight` so the bubble grows with content.
  const useBlur = Platform.OS === 'ios';
  const insideIcons =
    isEmpty && onVoicePress ? (
      <HStack align="center" spacing={8} style={{ paddingRight: 4 }}>
        <Pressable
          onPress={onVoicePress}
          hitSlop={6}
          accessibilityLabel="Voice message"
          testID={testID ? `${testID}-voice` : undefined}>
          <Icon name="mdi:microphone" size={20} color={fieldPlaceholder} />
        </Pressable>
      </HStack>
    ) : null;

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
            blur={useBlur}
            blurIntensity={60}
            blurTint="prominent"
            style={{
              width: BUTTON_SIZE,
              height: BUTTON_SIZE,
              borderRadius: BUTTON_SIZE / 2,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              backgroundColor: useBlur ? undefined : surfaceSecondary,
            }}>
            <Icon name="mdi:plus" size={ICON_SIZE} color={useBlur ? INVARIANT_WHITE : foreground} />
          </View>
        </Pressable>

        <View
          style={{
            flex: 1,
            height: fallbackRowHeight,
            position: 'relative',
            justifyContent: 'center',
          }}>
          <View
            pointerEvents="none"
            blur={useBlur}
            blurIntensity={60}
            blurTint="prominent"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: fallbackRowHeight / 2,
              overflow: 'hidden',
              backgroundColor: surfaceSecondary,
            }}
          />
          <HStack align="center" spacing={8} style={{ paddingHorizontal: 16 }}>
            <TextInput
              value={value}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={fieldPlaceholder}
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
          <Animated.View entering={ZoomIn.springify().damping(16)} exiting={ZoomOut.duration(120)}>
            <Pressable
              onPress={canSend ? handleSendPress : undefined}
              disabled={!canSend}
              accessibilityLabel="Send message"
              accessibilityRole="button"
              testID={testID ? `${testID}-send` : undefined}>
              <View
                blur={useBlur}
                blurIntensity={60}
                blurTint="prominent"
                style={{
                  width: BUTTON_SIZE,
                  height: BUTTON_SIZE,
                  borderRadius: BUTTON_SIZE / 2,
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  // Flat tier: emphasized primary-button fill for the send CTA.
                  backgroundColor: useBlur ? undefined : foreground,
                }}>
                <Icon
                  name="iconamoon:send-fill"
                  size={ICON_SIZE}
                  color={useBlur ? INVARIANT_WHITE : background}
                />
              </View>
            </Pressable>
          </Animated.View>
        ) : null}
      </HStack>
    </View>
  );
}
