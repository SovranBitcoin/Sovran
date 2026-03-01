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
  const [success, green400, green500] = useThemeColor([
    'success',
    'green-400',
    'green-500',
  ] as const);
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

  const glassModifiers = [
    frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
    glassEffect({
      shape: 'capsule' as const,
      glass: { tint: opacity(green500, 0.15), variant: 'regular' as const, interactive: true },
    }),
  ];

  const glassTextModifiers = [
    font({ size: textSize, design: 'monospaced' as const, weight: 'bold' as const }),
    foregroundStyle(success),
    frame({ height: 22, width: iosWidth, alignment: 'center' }),
  ];

  // iOS liquid glass with currency menu
  if (Platform.OS === 'ios' && supportsLiquidGlass() && enableCurrencyMenu) {
    return (
      <Host style={{ zIndex: 10 }} matchContents>
        <Menu
          onPrimaryAction={onPress}
          label={<SwiftUIText modifiers={glassTextModifiers}>{text}</SwiftUIText>}
          modifiers={glassModifiers}>
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

  // iOS liquid glass without menu
  if (Platform.OS === 'ios' && supportsLiquidGlass()) {
    return (
      <Host style={{ zIndex: 10 }} matchContents>
        <SwiftUIButton onPress={onPress} modifiers={glassModifiers}>
          <SwiftUIText modifiers={glassTextModifiers}>{text}</SwiftUIText>
        </SwiftUIButton>
      </Host>
    );
  }

  // Non-liquid-glass fallback (iOS <26, Android, etc.)
  const useCurrencySheet = Platform.OS === 'ios' && enableCurrencyMenu;
  const primaryHandler = useCurrencySheet && !onPress ? openCurrencySheet : onPress;
  const longPressHandler = useCurrencySheet && onPress ? openCurrencySheet : undefined;

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
