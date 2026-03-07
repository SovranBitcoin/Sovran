import React from 'react';
import { Host, Menu, Button as SwiftUIButton, Text as SwiftUIText } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import opacity from 'hex-color-opacity';

import type { FiatCurrencyPillShared } from './useFiatCurrencyPill';

export function FiatCurrencyPillLiquid({
  success,
  green500,
  handleSelectCurrency,
  text,
  iosHeight,
  iosWidth,
  onPress,
  enableCurrencyMenu,
  textSize,
}: FiatCurrencyPillShared): React.ReactElement {
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

  if (enableCurrencyMenu) {
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

  return (
    <Host style={{ zIndex: 10 }} matchContents>
      <SwiftUIButton onPress={onPress} modifiers={glassModifiers}>
        <SwiftUIText modifiers={glassTextModifiers}>{text}</SwiftUIText>
      </SwiftUIButton>
    </Host>
  );
}
