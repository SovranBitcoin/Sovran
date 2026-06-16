import React from 'react';
import { View as RNView } from 'react-native';
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
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';
import { zIndex } from '@/shared/styles/tokens';

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  const { handleSelectCurrency, text, iosHeight, iosWidth, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);

  const colorScheme = useColorScheme();
  const textColor = useThemeColor('foreground');
  const glassModifiers = [
    environment('colorScheme', colorScheme),
    frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
    glassEffect({
      shape: 'capsule' as const,
      glass: {
        tint: opacity(INVARIANT_WHITE, 0.15),
        variant: 'regular' as const,
        interactive: true,
      },
    }),
  ];

  const glassTextModifiers = [
    font({ size: textSize, design: 'monospaced' as const, weight: 'bold' as const }),
    foregroundStyle(textColor),
    frame({ height: 22, width: iosWidth, alignment: 'center' }),
  ];

  // Renders each menu row's systemImage in the default label color
  // instead of the inherited system accent (which would tint $/€/£).
  const menuItemModifiers = [
    foregroundStyle({ type: 'hierarchical' as const, style: 'primary' as const }),
  ];

  if (enableCurrencyMenu) {
    return (
      // collapsable={false} forces a stable native wrapper UIView so the
      // SwiftUI Host (UIHostingController) is a real subview of the scroll
      // content and tracks its transform, instead of pinning to the top
      // (see expo/expo#46278). Experimental — GlassView is the guaranteed fix.
      <RNView collapsable={false}>
        <Host style={{ zIndex: zIndex.sticky }} matchContents>
          <Menu
            onPrimaryAction={onPress}
            label={<SwiftUIText modifiers={glassTextModifiers}>{text}</SwiftUIText>}
            modifiers={glassModifiers}>
            <SwiftUIButton
              systemImage="dollarsign"
              label="USD"
              modifiers={menuItemModifiers}
              onPress={() => handleSelectCurrency('usd')}
            />
            <SwiftUIButton
              systemImage="eurosign"
              label="EUR"
              modifiers={menuItemModifiers}
              onPress={() => handleSelectCurrency('eur')}
            />
            <SwiftUIButton
              systemImage="sterlingsign"
              label="GBP"
              modifiers={menuItemModifiers}
              onPress={() => handleSelectCurrency('gbp')}
            />
          </Menu>
        </Host>
      </RNView>
    );
  }

  return (
    <RNView collapsable={false}>
      <Host style={{ zIndex: zIndex.sticky }} matchContents>
        <SwiftUIButton onPress={onPress} modifiers={glassModifiers}>
          <SwiftUIText modifiers={glassTextModifiers}>{text}</SwiftUIText>
        </SwiftUIButton>
      </Host>
    </RNView>
  );
}
