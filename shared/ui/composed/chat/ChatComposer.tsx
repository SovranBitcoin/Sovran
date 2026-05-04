import React, { useCallback, useRef } from 'react';
import { TextInput, View, type LayoutChangeEvent } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import Icon from 'assets/icons';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { chatLog } from '@/shared/lib/logger';
import opacity from 'hex-color-opacity';

interface ChatComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Iconify name shown in the leading action chip. Visual identity for the
   * transport — geohash uses `mdi:map-marker`, BitChat-DM uses
   * `mdi:bluetooth`, etc. Rendered as a small chip in the action row. */
  leadingIcon?: string;
  /** Custom leading glyph node (takes precedence over `leadingIcon`). Use
   * for transports whose identity is an emoji or custom asset rather than
   * an iconify glyph (e.g. Marmot/White Noise). */
  leadingIconNode?: React.ReactNode;
  /** Extra chip(s) placed in the action row, left of the send button. Used
   * by the AI surface to expose a model picker; omitted by plain DM
   * surfaces. */
  actionsLeading?: React.ReactNode;
  /**
   * Override the bottom padding (the space below the bubble). Defaults to
   * 12 to match the horizontal margin — gives even spacing on pushed-screen
   * chats (Geohash, Whitenoise, Nostr DM). Tab-hosted screens (AI) pass an
   * explicit value (often 0, with the spacing animated on a Reanimated
   * wrapper) so the bubble can track the keyboard smoothly.
   */
  bottomPadding?: number;
  testID?: string;
  /** Tag attached to all `chat.composer.*` perf logs so log-doctor can split
   * keyboard / layout / send timing per surface (`ai`, `whitenoise`, `nostr`,
   * `bitchat-geohash`, `bitchat-ble`, `bitchat-dm`). Optional only because a
   * handful of pre-instrumentation call sites still need updating. */
  surface?: string;
}

const BUBBLE_RADIUS = 24;
const ACTION_HEIGHT = 32;

/**
 * Single-bubble composer shared across all chat surfaces. The bubble holds
 * the text field on top and a chip/action row below — leading transport
 * identity + optional surface-specific chips on the left, send button on
 * the right.
 */
export function ChatComposer({
  value,
  onChangeText,
  onSend,
  disabled,
  placeholder = 'Type a message...',
  leadingIcon,
  leadingIconNode,
  actionsLeading,
  bottomPadding: bottomPaddingOverride,
  testID,
  surface,
}: ChatComposerProps) {
  const [foreground, accent, surfaceSecondary, surfaceTertiary, shade500] = useThemeColor([
    'foreground',
    'accent',
    'surface-secondary',
    'surface-tertiary',
    'shade-500',
  ] as const);

  const canSend = value.trim().length > 0 && !disabled;
  const hasLeadingIdentity = leadingIconNode != null || leadingIcon != null;
  const hasActionsRow = hasLeadingIdentity || actionsLeading != null;

  // Default matches the 12pt horizontal margin so the bubble sits with
  // even gaps on all sides — much tighter than the old `insets.bottom`
  // default (which left ~34pt of dead space on iPhones with a home
  // indicator). Tab-hosted callers (AI screen) pass `bottomPadding={0}`
  // and animate the spacing on a Reanimated wrapper so the bubble can
  // track the keyboard smoothly.
  const bottomPadding = bottomPaddingOverride ?? 12;

  // Track last reported {height,y} per surface so we only emit on real
  // changes — RN fires `onLayout` on every parent reflow even when the
  // composer's own frame hasn't moved. Per the log-doctor noise rules
  // (>15% = noise), unfiltered onLayout floods the timeline.
  const lastLayoutRef = useRef<{ height: number; y: number; width: number } | null>(null);

  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      const last = lastLayoutRef.current;
      const changed =
        !last ||
        Math.abs(last.height - height) >= 0.5 ||
        Math.abs(last.y - y) >= 0.5 ||
        Math.abs(last.width - width) >= 0.5;
      if (!changed) return;
      lastLayoutRef.current = { height, y, width };
      chatLog.debug('chat.composer.layout', {
        surface: surface ?? 'unknown',
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
        bottomPadding,
        hasActionsRow,
      });
    },
    [surface, bottomPadding, hasActionsRow]
  );

  const handleSendPress = useCallback(() => {
    chatLog.info('chat.composer.send_tap', {
      surface: surface ?? 'unknown',
      textLen: value.length,
      disabled,
    });
    onSend();
  }, [surface, value.length, disabled, onSend]);

  return (
    <View
      onLayout={handleLayout}
      style={{
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: bottomPadding,
      }}>
      <View
        style={{
          backgroundColor: surfaceSecondary,
          borderRadius: BUBBLE_RADIUS,
          borderWidth: 1,
          borderColor: opacity(foreground, 0.06),
          paddingHorizontal: 14,
          paddingTop: 10,
          paddingBottom: 6,
        }}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={shade500}
          editable={!disabled}
          style={{
            color: foreground,
            fontSize: 16,
            lineHeight: 22,
            minHeight: 22,
            maxHeight: 140,
            padding: 0,
            margin: 0,
          }}
          multiline
          maxLength={1000}
          returnKeyType="send"
          onSubmitEditing={handleSendPress}
          testID={testID}
        />

        <HStack align="center" spacing={6} style={{ marginTop: hasActionsRow ? 6 : 4 }}>
          {hasLeadingIdentity ? (
            <View
              style={{
                width: ACTION_HEIGHT,
                height: ACTION_HEIGHT,
                borderRadius: ACTION_HEIGHT / 2,
                backgroundColor: surfaceTertiary,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              {leadingIconNode ?? <Icon name={leadingIcon as string} size={16} color={accent} />}
            </View>
          ) : null}

          {actionsLeading}

          <View style={{ flex: 1 }} />

          <Pressable
            onPress={handleSendPress}
            disabled={!canSend}
            testID={testID ? `${testID}-send` : undefined}
            style={{
              width: ACTION_HEIGHT,
              height: ACTION_HEIGHT,
              borderRadius: ACTION_HEIGHT / 2,
              backgroundColor: canSend ? foreground : opacity(foreground, 0.1),
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Icon
              name="iconamoon:send-fill"
              size={16}
              color={canSend ? surfaceSecondary : opacity(foreground, 0.35)}
            />
          </Pressable>
        </HStack>
      </View>
    </View>
  );
}
