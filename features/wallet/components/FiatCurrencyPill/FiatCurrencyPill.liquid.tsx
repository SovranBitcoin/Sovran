/**
 * iOS 26+ Liquid Glass variant: a real glass capsule via expo-glass-effect's
 * GlassView (a UIVisualEffectView-backed React Native view). We deliberately do
 * NOT use an @expo/ui SwiftUI `Host` here: Host views (UIHostingController) don't
 * follow an RN ScrollView's content transform and visually pin to the top while
 * scrolling (expo/expo#46278). GlassView scrolls like any RN view.
 *
 * Currency selection reuses the ActionSheetIOS path from the blur variant
 * instead of a native SwiftUI Menu, so the picker stays consistent and the pill
 * remains a plain scrollable RN view.
 */

import React, { useCallback } from 'react';
import { ActionSheetIOS } from 'react-native';
import opacity from 'hex-color-opacity';

import { GlassView } from 'expo-glass-effect';

import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillLiquid(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, handleSelectCurrency, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();
  const textColor = useThemeColor('foreground');

  const openCurrencySheet = useCallback(() => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['USD', 'EUR', 'GBP', 'Cancel'],
        cancelButtonIndex: 3,
        userInterfaceStyle: colorScheme,
      },
      (buttonIndex) => {
        if (buttonIndex === 0) handleSelectCurrency('usd');
        if (buttonIndex === 1) handleSelectCurrency('eur');
        if (buttonIndex === 2) handleSelectCurrency('gbp');
      }
    );
  }, [handleSelectCurrency, colorScheme]);

  const primaryHandler = enableCurrencyMenu && !onPress ? openCurrencySheet : onPress;
  const longPressHandler = enableCurrencyMenu && onPress ? openCurrencySheet : undefined;

  return (
    <Pressable
      disabled={!primaryHandler && !longPressHandler}
      onPress={primaryHandler}
      onLongPress={longPressHandler}>
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        tintColor={opacity(INVARIANT_WHITE, 0.15)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          borderRadius: 999,
          paddingHorizontal: 14,
          paddingVertical: 6,
          minHeight: iosHeight,
        }}>
        <Text overpass size={textSize} bold color={textColor} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </GlassView>
    </Pressable>
  );
}
