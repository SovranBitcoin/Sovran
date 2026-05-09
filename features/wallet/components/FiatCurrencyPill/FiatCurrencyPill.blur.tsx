/**
 * iOS non-liquid variant. Same tinted-flat chrome as the Android (`flat`)
 * variant, plus ActionSheetIOS-driven currency selection — preserves
 * today's behavior on older iOS without the SwiftUI Menu.
 *
 * The dispatcher slots this in for `frostedSurface && !liquidGlass`. Named
 * `blur` to match the Capabilities axis even though no `BlurView` is
 * involved — the chrome is a tinted overlay.
 */

import React, { useCallback } from 'react';
import { ActionSheetIOS } from 'react-native';
import opacity from 'hex-color-opacity';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillBlur(props: FiatCurrencyPillProps): React.ReactElement {
  const {
    text,
    success,
    green400,
    green500,
    iosHeight,
    handleSelectCurrency,
    onPress,
    enableCurrencyMenu,
    textSize,
  } = useFiatCurrencyPill(props);

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

  const primaryHandler = enableCurrencyMenu && !onPress ? openCurrencySheet : onPress;
  const longPressHandler = enableCurrencyMenu && onPress ? openCurrencySheet : undefined;

  return (
    <Pressable
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
        <Text overpass size={textSize} bold color={success} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </Pressable>
  );
}
