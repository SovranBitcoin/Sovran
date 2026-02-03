import React, { useCallback } from 'react';
import { Platform } from 'react-native';
import opacity from 'hex-color-opacity';
import { Host, ContextMenu, Button as SwiftUIButton, Text as SwiftUIText } from '@expo/ui/swift-ui';
import {
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  background,
  cornerRadius,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';

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
  const iosHeight = 34;
  // Expo SwiftUI wrappers often need an explicit frame to avoid collapsed width.
  // Approximate monospace character width: ~0.62em + fixed padding.
  const iosWidth = Math.max(72, Math.round(text.length * (textSize * 0.62) + 28));

  // Use SwiftUI ContextMenu with liquid glass button on iOS
  if (Platform.OS === 'ios' && enableCurrencyMenu) {
    return (
      <Host style={{ zIndex: 10 }} matchContents>
        <ContextMenu>
          <ContextMenu.Items>
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
          </ContextMenu.Items>
          <ContextMenu.Trigger>
            <SwiftUIButton
              onPress={onPress}
              modifiers={[
                buttonStyle('glass'),
                frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
                background(opacity(getGreenColor('500'), 0.15)),
                cornerRadius(100),
                // Ensure we keep the liquid glass material even when adding tint/background.
                glassEffect({ shape: 'capsule' }),
              ]}>
              <SwiftUIText
                // Important: the "glass" capsule tends to size to the label, while our
                // background tint sizes to the outer frame. Keep them identical.
                modifiers={[
                  font({ size: textSize, design: 'monospaced', weight: 'bold' }),
                  foregroundStyle(getGreenColor('300')),
                  frame({ height: 22, width: iosWidth, alignment: 'center' }),
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
      <Host style={{ zIndex: 10 }} matchContents>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            buttonStyle('glass'),
            frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
            background(opacity(getGreenColor('500'), 0.15)),
            cornerRadius(100),
            // Ensure we keep the liquid glass material even when adding tint/background.
            glassEffect({ shape: 'capsule' }),
          ]}>
          <SwiftUIText
            // Important: the "glass" capsule tends to size to the label, while our
            // background tint sizes to the outer frame. Keep them identical.
            modifiers={[
              font({ size: textSize, design: 'monospaced', weight: 'bold' }),
              foregroundStyle(getGreenColor('300')),
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
