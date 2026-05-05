import React, { useCallback, useRef } from 'react';
import { Platform, TextInput, type LayoutChangeEvent } from 'react-native';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Spacer as SwiftUISpacer,
} from '@expo/ui/swift-ui';
import { buttonStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import opacity from 'hex-color-opacity';

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
const INPUT_MIN_HEIGHT = 44;
const INPUT_MAX_HEIGHT = 140;

/**
 * Liquid-glass DM-surface composer. Visual language: three glass shapes
 * laid out left-to-right — leading [+] (accent-tinted), middle text input
 * (capsule, regular tint), trailing [→] (accent-tinted, mounted only when
 * the input has content). Money + voice icons render inside the input on
 * the right while the input is empty.
 *
 * Renders true SwiftUI `glassEffect` on iOS 26+ (`supportsLiquidGlass()`),
 * falling back to the standard `View blur` primitive elsewhere — same
 * split that `CircleActionButton.ios` and `CapsuleButton.liquid` use.
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
  const [foreground, accent, surfaceTertiary, shade400, shade500] = useThemeColor([
    'foreground',
    'accent',
    'surface-tertiary',
    'shade-400',
    'shade-500',
  ] as const);

  const trimmedHasText = value.trim().length > 0;
  const canSend = trimmedHasText && !disabled;
  const isEmpty = value.length === 0;
  const useNativeGlass = Platform.OS === 'ios' && supportsLiquidGlass();
  const accentTint = opacity(accent, 0.6);
  const inputTint = opacity(foreground, 0.08);

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

  const renderGlassCircleButton = (params: {
    onPress: () => void;
    iconName: string;
    systemIconName: string;
    tintHex: string;
    accessibilityLabel: string;
    disabled?: boolean;
  }) => {
    const { onPress, iconName, systemIconName, tintHex, accessibilityLabel } = params;
    const interactive = !params.disabled;

    if (useNativeGlass) {
      return (
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityState={{ disabled: !interactive }}
          style={{ height: BUTTON_SIZE, width: BUTTON_SIZE }}>
          <Host style={{ height: BUTTON_SIZE, width: BUTTON_SIZE }} matchContents={false}>
            <SwiftUIButton
              modifiers={[
                buttonStyle('glass'),
                frame({ height: BUTTON_SIZE, width: BUTTON_SIZE }),
                glassEffect({
                  shape: 'circle',
                  glass: { variant: 'regular', tint: tintHex, interactive },
                }),
              ]}
              onPress={interactive ? onPress : () => {}}>
              <SwiftUIHStack
                alignment="center"
                modifiers={[
                  frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'center' }),
                ]}>
                <SwiftUIImage
                  systemName={systemIconName as never}
                  size={ICON_SIZE}
                  color={'#FFFFFF'}
                />
              </SwiftUIHStack>
            </SwiftUIButton>
          </Host>
        </View>
      );
    }

    return (
      <Pressable
        onPress={interactive ? onPress : undefined}
        disabled={!interactive}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [
          {
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            opacity: pressed && interactive ? 0.8 : 1,
          },
        ]}>
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
            backgroundColor: tintHex,
          }}>
          <Icon name={iconName} size={ICON_SIZE} color={'#FFFFFF'} />
        </View>
      </Pressable>
    );
  };

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

  return (
    <View
      onLayout={handleLayout}
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: bottomPadding,
      }}>
      <HStack align="flex-end" spacing={8}>
        {/* Leading [+] glass button — always visible */}
        {renderGlassCircleButton({
          onPress: handlePlusPress,
          iconName: 'mdi:plus',
          systemIconName: 'plus',
          tintHex: accentTint,
          accessibilityLabel: 'Composer actions',
          disabled,
        })}

        {/* Input bubble — flex 1, glass background, RN TextInput on top */}
        <View
          style={{
            flex: 1,
            minHeight: INPUT_MIN_HEIGHT,
            justifyContent: 'center',
            position: 'relative',
          }}>
          {useNativeGlass ? (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
              <Host style={{ width: '100%', height: '100%' }} matchContents={false}>
                <SwiftUIHStack
                  alignment="center"
                  modifiers={[
                    frame({ maxWidth: Infinity, maxHeight: Infinity }),
                    glassEffect({
                      shape: 'capsule',
                      glass: { variant: 'regular', tint: inputTint, interactive: false },
                    }),
                  ]}>
                  <SwiftUISpacer />
                </SwiftUIHStack>
              </Host>
            </View>
          ) : (
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
                borderRadius: INPUT_MIN_HEIGHT / 2,
                overflow: 'hidden',
                backgroundColor: surfaceTertiary,
              }}
            />
          )}

          <HStack align="center" spacing={8} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
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
              testID={testID}
              style={{
                flex: 1,
                color: foreground,
                fontSize: 16,
                lineHeight: 22,
                minHeight: 22,
                maxHeight: INPUT_MAX_HEIGHT - 16, // -vertical padding
                padding: 0,
                margin: 0,
              }}
            />
            {insideIcons}
          </HStack>
        </View>

        {/* Trailing [→] glass send button — only when text present */}
        {trimmedHasText
          ? renderGlassCircleButton({
              onPress: handleSendPress,
              iconName: 'iconamoon:send-fill',
              systemIconName: 'arrow.up',
              tintHex: accentTint,
              accessibilityLabel: 'Send message',
              disabled: !canSend,
            })
          : null}
      </HStack>
    </View>
  );
}
