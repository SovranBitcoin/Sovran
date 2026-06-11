import React from 'react';
import opacity from 'hex-color-opacity';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, onPress, textSize } = useFiatCurrencyPill(props);
  const textColor = useThemeColor('foreground');

  return (
    <Pressable disabled={!onPress} onPress={onPress}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          backgroundColor: opacity(INVARIANT_WHITE, 0.15),
          borderWidth: 1,
          // Standard border alpha (the app-wide 0.3 contract); fill stays
          // INVARIANT_WHITE — this pill sits over the wallet wallpaper.
          borderColor: opacity(INVARIANT_WHITE, 0.3),
          paddingHorizontal: 14,
          paddingVertical: 6,
          minHeight: iosHeight,
        }}>
        <Text overpass size={textSize} bold color={textColor} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </Pressable>
  );
}
