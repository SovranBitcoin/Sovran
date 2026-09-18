import { useCallback, useRef, useState } from 'react';
import {
  TextInput,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputContentSizeChangeEventData,
} from 'react-native';
import Animated, { ZoomIn, ZoomOut } from 'react-native-reanimated';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useCapabilities } from '@/shared/ui/capability';
import { chatLog } from '@/shared/lib/logger';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';

import { LiquidChatComposerGlass } from './LiquidChatComposerGlass';
import { plusA11yLabel } from './LiquidChatComposerGlass.types';
import { BUTTON_SIZE, GAP, ICON_SIZE } from './liquidChatComposerMetrics';

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
   * Renders the [+] button dimmed and inert while keeping it mounted (the
   * three-shape glass layout must not reflow). Used by the AI surface when
   * the resolved model lacks vision input — a dimmed affordance reads as
   * "exists, unavailable here", where unmounting would read as a layout
   * bug and a silent no-op reads as broken.
   */
  plusDisabled?: boolean;
  /** Bottom padding below the bubble. Defaults to 12 (matches horizontal margin). */
  bottomPadding?: number;
  testID?: string;
  /** log-doctor surface tag, threaded into `chat.composer.*` events. */
  surface?: string;
}

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
 * **Liquid-glass path** (`useCapabilities().liquidGlass`, iOS 26+) is pure
 * SwiftUI and lives in `LiquidChatComposerGlass.ios.tsx`, so
 * `@expo/ui/swift-ui` never reaches the Android bundle. No RN `TextInput`
 * overlay, no row-height feedback loop, no placeholder baseline mismatch.
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
  plusDisabled,
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
  const { liquidGlass: useNativeGlass, frostedSurface } = useCapabilities();

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
    chatLog.info('chat.composer.plus_tap', { surface: surface ?? 'unknown', plusDisabled });
    if (plusDisabled) return;
    onPlusPress?.();
  }, [surface, onPlusPress, plusDisabled]);

  if (useNativeGlass) {
    return (
      <LiquidChatComposerGlass
        value={value}
        onChangeText={onChangeText}
        onSend={handleSendPress}
        onPlusPress={handlePlusPress}
        onLayout={handleLayout}
        disabled={disabled}
        plusDisabled={plusDisabled}
        placeholder={placeholder}
        bottomPadding={bottomPadding}
        hasText={trimmedHasText}
        canSend={canSend}
        foreground={foreground}
      />
    );
  }

  // Fallback — frosted-surface devices (iOS < 26) keep real frosted-glass
  // blur; Android gets the flat contract (surface-secondary fills, no blur —
  // expo-blur there reads as a muddy tint). The [→] springs in/out via
  // reanimated. The RN multiline TextInput drives `fallbackRowHeight` so the
  // bubble grows with content.
  const useBlur = frostedSurface;
  const insideIcons = null;

  return (
    <View
      onLayout={handleLayout}
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: bottomPadding,
      }}>
      <HStack align="flex-end" gap={GAP}>
        <Pressable
          onPress={disabled ? undefined : handlePlusPress}
          disabled={disabled || plusDisabled}
          accessibilityLabel={plusA11yLabel(plusDisabled)}
          testID={testID ? `${testID}-plus` : undefined}
          accessibilityState={{ disabled: !!(disabled || plusDisabled) }}
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
              opacity: plusDisabled ? 0.35 : 1,
              backgroundColor: useBlur ? undefined : surfaceSecondary,
            }}>
            <Icon name="mdi:plus" size={ICON_SIZE} color={useBlur ? INVARIANT_WHITE : foreground} />
          </View>
        </Pressable>

        <View
          // The multiline TextInput inside surfaces neither its testID nor an
          // accessibilityLabel on iOS, so the field CONTAINER carries the AX
          // identity; a center tap on it focuses the input for typing.
          testID={testID ? `${testID}-field` : undefined}
          accessible={!!testID}
          accessibilityLabel={testID ? 'Message composer' : undefined}
          style={{
            flex: 1,
            height: fallbackRowHeight,
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
          <HStack align="center" gap={8} style={{ paddingHorizontal: 16 }}>
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
              // iOS drops accessibilityIdentifier on this multiline input, so
              // the label is the only reliable AX handle (and VoiceOver's).
              accessibilityLabel="Message composer"
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
