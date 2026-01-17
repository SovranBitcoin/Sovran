import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import opacity from 'hex-color-opacity';
import { Host, ContextMenu, Button as SwiftUIButton, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { frame, background, cornerRadius } from '@expo/ui/swift-ui/modifiers';

import { HStack } from 'components/ui/View/HStack';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useTheme } from 'providers/ThemeProvider';
import { DisplayCurrency, useSettingsStore } from 'stores/settingsStore';

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
  const { getGreenColor } = useTheme();
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

  // Use SwiftUI ContextMenu with liquid glass button on iOS
  if (Platform.OS === 'ios' && enableCurrencyMenu) {
    return (
      <Host style={{ zIndex: 10 }} matchContents fixedSize={true}>
        <ContextMenu>
          <ContextMenu.Items>
            <SwiftUIButton systemImage="dollarsign" onPress={() => handleSelectCurrency('usd')}>
              USD
            </SwiftUIButton>
            <SwiftUIButton systemImage="eurosign" onPress={() => handleSelectCurrency('eur')}>
              EUR
            </SwiftUIButton>
            <SwiftUIButton systemImage="sterlingsign" onPress={() => handleSelectCurrency('gbp')}>
              GBP
            </SwiftUIButton>
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <SwiftUIButton
              variant="glass"
              onPress={onPress}
              modifiers={[
                frame({ alignment: 'center' }),
                background(opacity(getGreenColor('500'), 0.15)),
                cornerRadius(100),
              ]}>
              <SwiftUIText
                design={'monospaced'}
                weight="bold"
                color={getGreenColor('300')}
                size={textSize}
                modifiers={[
                  frame({ height: 22, alignment: 'center', width: text.length * 10 + 12 }),
                ]}>
                {text}
              </SwiftUIText>
            </SwiftUIButton>
          </ContextMenu.Trigger>
        </ContextMenu>
      </Host>
    );
  }

  // iOS, but menu disabled: still use liquid-glass button for consistent look.
  if (Platform.OS === 'ios') {
    return (
      <Host style={{ zIndex: 10 }} matchContents fixedSize={true}>
        <SwiftUIButton
          variant="glass"
          onPress={onPress}
          modifiers={[
            frame({ alignment: 'center' }),
            background(opacity(getGreenColor('500'), 0.15)),
            cornerRadius(100),
          ]}>
          <SwiftUIText
            design={'monospaced'}
            weight="bold"
            color={getGreenColor('300')}
            size={textSize}
            modifiers={[frame({ height: 22, alignment: 'center', width: text.length * 10 + 12 })]}>
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
          backgroundColor: opacity(getGreenColor('500'), 0.15),
          borderWidth: 1,
          borderColor: opacity(getGreenColor('400'), 0.2),
          paddingHorizontal: 14,
          paddingVertical: 6,
        }}>
        <Text
          size={textSize}
          bold
          overpass
          color={getGreenColor('300')}
          style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </TouchableOpacity>
  );
}
