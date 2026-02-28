import React, { useCallback } from 'react';
import { ActionSheetIOS, Platform } from 'react-native';
import opacity from 'hex-color-opacity';
import { Host, Menu, Button as SwiftUIButton, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';

import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { DisplayCurrency, useSettingsStore } from 'stores/settingsStore';
import { supportsLiquidGlass } from '@/helper/version';
import { useThemeColor } from 'hooks/useThemeColor';
export interface FiatCurrencyPillProps {
  /** Display string, e.g. "≈ $12.34" */
  displayText: string;
  /** Called on a normal tap (e.g. toggle sats/fiat input mode) */
  onPress?: () => void;
  /** Optional override for currency selection side-effects */
  onSelectCurrency?: (currency: DisplayCurrency) => void;
  /** Append a small toggle glyph (e.g. "⇄") to hint tap-to-toggle behavior */
  showToggleGlyph?: boolean;
  /** Text size for both iOS + non-iOS renderers */
  textSize?: number;
  /** Enable the iOS ContextMenu for fiat currency selection (wallet UX). */
  enableCurrencyMenu?: boolean;
}

export function FiatCurrencyPill({
  displayText,
  onPress,
  onSelectCurrency,
  showToggleGlyph = false,
  textSize = 14,
  enableCurrencyMenu = true,
}: FiatCurrencyPillProps): React.ReactElement {
  const [success, green400, green500] = useThemeColor(['success', 'green-400', 'green-500'] as const);
  const setDisplayCurrency = useSettingsStore((state) => state.setDisplayCurrency);

  const handleSelectCurrency = useCallback(
    (currency: DisplayCurrency) => {
      if (onSelectCurrency) {
        onSelectCurrency(currency);
        return;
      }
      setDisplayCurrency(currency);
    },
    [onSelectCurrency, setDisplayCurrency]
  );

  const text = showToggleGlyph ? `${displayText}  ⇄` : displayText;
  const iosHeight = 34;
  // Expo SwiftUI wrappers often need an explicit frame to avoid collapsed width.
  // Approximate monospace character width: ~0.62em + fixed padding.
  const iosWidth = Math.max(72, Math.round(text.length * (textSize * 0.62) + 28));

  const openCurrencySheet = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['USD', 'EUR', 'GBP', 'Cancel'],
        cancelButtonIndex: 3,
        userInterfaceStyle: 'dark',
      },
      (buttonIndex) => {
        if (buttonIndex === 0) handleSelectCurrency('usd');
        if (buttonIndex === 1) handleSelectCurrency('eur');
        if (buttonIndex === 2) handleSelectCurrency('gbp');
      }
    );
  }, [handleSelectCurrency]);

  // Non-Liquid Glass fallback on iOS: use RN capsule, and ActionSheet for currency selection.
  if (Platform.OS === 'ios' && !supportsLiquidGlass()) {
    const primaryHandler = enableCurrencyMenu && !onPress ? openCurrencySheet : onPress;
    const longPressHandler = enableCurrencyMenu && onPress ? openCurrencySheet : undefined;

    return (
      <TouchableOpacity
        disabled={!primaryHandler && !longPressHandler}
        onPress={primaryHandler}
        onLongPress={longPressHandler}>
        <HStack
          align="center"
          justify="center"
          gap={6}
          className="overflow-hidden rounded-full"
          style={{
            backgroundColor: opacity(green500, 0.15),
            borderWidth: 1,
            borderColor: opacity(green400, 0.2),
            paddingHorizontal: 14,
            paddingVertical: 6,
            minHeight: iosHeight,
          }}>
          <Text size={textSize} bold overpass color={success} style={{ letterSpacing: 0.3 }}>
            {text}
          </Text>
        </HStack>
      </TouchableOpacity>
    );
  }

  // Use SwiftUI ContextMenu with liquid glass button on iOS
  if (Platform.OS === 'ios' && enableCurrencyMenu) {
    return (
      <Host style={{ zIndex: 10 }} matchContents>
        <Menu
          // If `onPress` is provided, a tap triggers that action and a long-press shows the menu.
          // If `onPress` is not provided (e.g. PrimaryBalance), a tap opens the menu directly.
          onPrimaryAction={onPress}
          label={
            <SwiftUIText
              // Important: keep label sizing aligned with the outer capsule frame.
              modifiers={[
                font({ size: textSize, design: 'monospaced', weight: 'bold' }),
                foregroundStyle(success),
                frame({ height: 22, width: iosWidth, alignment: 'center' }),
              ]}>
              {text}
            </SwiftUIText>
          }
          modifiers={[
            frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
            glassEffect({
              shape: 'capsule',
              glass: {
                tint: opacity(green500, 0.15),
                variant: 'regular',
                interactive: true,
              },
            }),
          ]}>
          <SwiftUIButton
            systemImage="dollarsign"
            label="USD"
            onPress={() => handleSelectCurrency('usd')}
          />
          <SwiftUIButton
            systemImage="eurosign"
            label="EUR"
            onPress={() => handleSelectCurrency('eur')}
          />
          <SwiftUIButton
            systemImage="sterlingsign"
            label="GBP"
            onPress={() => handleSelectCurrency('gbp')}
          />
        </Menu>
      </Host>
    );
  }

  // iOS, but menu disabled: still use liquid-glass button for consistent look.
  if (Platform.OS === 'ios') {
    return (
      <Host style={{ zIndex: 10 }} matchContents>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            // buttonStyle('glass'),
            frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
            // Keep tint consistent with the menu-enabled variant.
            glassEffect({
              shape: 'capsule',
              glass: {
                tint: opacity(green500, 0.15),
                variant: 'regular',
                interactive: true,
              },
            }),
          ]}>
          <SwiftUIText
            modifiers={[
              font({ size: textSize, design: 'monospaced', weight: 'bold' }),
              foregroundStyle(success),
              frame({ height: 22, width: iosWidth, alignment: 'center' }),
            ]}>
            {text}
          </SwiftUIText>
        </SwiftUIButton>
      </Host>
    );
  }

  // Fallback for non-iOS platforms
  return (
    <TouchableOpacity disabled={!onPress} onPress={onPress}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          backgroundColor: opacity(green500, 0.15),
          borderWidth: 1,
          borderColor: opacity(green400, 0.2),
          paddingHorizontal: 14,
          paddingVertical: 6,
        }}>
        <Text size={textSize} bold overpass color={success} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </TouchableOpacity>
  );
}
