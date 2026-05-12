import React from 'react';
import opacity from 'hex-color-opacity';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, green400, iosHeight, onPress, textSize } = useFiatCurrencyPill(props);
  const [muted, foreground] = useThemeColor(['muted', 'foreground'] as const);

  return (
    <Pressable disabled={!onPress} onPress={onPress}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          backgroundColor: opacity(green400, 0.4),
          borderWidth: 1,
          borderColor: opacity(muted, 0.3),
          paddingHorizontal: 14,
          paddingVertical: 6,
          minHeight: iosHeight,
        }}>
        <Text overpass size={textSize} bold color={foreground} style={{ letterSpacing: 0.3 }}>
          {text}
        </Text>
      </HStack>
    </Pressable>
  );
}
