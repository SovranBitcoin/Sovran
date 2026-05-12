import React from 'react';
import { Host, Menu, Button as SwiftUIButton, Text as SwiftUIText } from '@expo/ui/swift-ui';
import {
  environment,
  font,
  foregroundStyle,
  frame,
  glassEffect,
} from '@expo/ui/swift-ui/modifiers';
import opacity from 'hex-color-opacity';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';
import { zIndex } from '@/shared/styles/tokens';

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    green500,
    handleSelectCurrency,
    text,
    iosHeight,
    iosWidth,
    onPress,
    enableCurrencyMenu,
    textSize,
  } = useFiatCurrencyPill(props);

  const colorScheme = useColorScheme();
  const [foreground] = useThemeColor(['foreground'] as const);
  const glassModifiers = [
    environment('colorScheme', colorScheme),
    frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
    glassEffect({
      shape: 'capsule' as const,
      glass: { tint: opacity(green500, 0.28), variant: 'regular' as const, interactive: true },
    }),
  ];

  const glassTextModifiers = [
    font({ size: textSize, design: 'monospaced' as const, weight: 'bold' as const }),
    foregroundStyle(foreground),
    frame({ height: 22, width: iosWidth, alignment: 'center' }),
  ];

  if (enableCurrencyMenu) {
    return (
      <Host style={{ zIndex: zIndex.sticky }} matchContents>
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

  return (
    <Host style={{ zIndex: zIndex.sticky }} matchContents>
      <SwiftUIButton onPress={onPress} modifiers={glassModifiers}>
        <SwiftUIText modifiers={glassTextModifiers}>{text}</SwiftUIText>
      </SwiftUIButton>
    </Host>
  );
}
