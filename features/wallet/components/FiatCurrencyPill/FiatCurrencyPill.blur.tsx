/**
 * iOS non-liquid variant: a real BlurView capsule with a white wash,
 * mirroring CircleActionButton.blur's chrome (intensity 60, light tint)
 * so the wallet's pill and toolbar buttons feel like the same family.
 * Adds ActionSheetIOS-driven currency selection — preserves today's
 * behavior on older iOS without the SwiftUI Menu.
 *
 * The dispatcher slots this in for `frostedSurface && !liquidGlass`.
 */

import React, { useCallback } from 'react';
import { ActionSheetIOS } from 'react-native';
import opacity from 'hex-color-opacity';

import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillBlur(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, handleSelectCurrency, onPress, enableCurrencyMenu, textSize } =
    useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();
  const textColor = colorScheme === 'light' ? '#000000' : '#FFFFFF';

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
      <View
        blur
        blurIntensity={60}
        blurTint="light"
        colorBlur={opacity('#FFFFFF', 0.15)}
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
      </View>
    </Pressable>
  );
}
