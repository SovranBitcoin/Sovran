import React from 'react';
import opacity from 'hex-color-opacity';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, iosHeight, onPress, textSize } = useFiatCurrencyPill(props);
  const colorScheme = useColorScheme();
  const textColor = colorScheme === 'light' ? '#000000' : '#FFFFFF';

  return (
    <Pressable disabled={!onPress} onPress={onPress}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          backgroundColor: opacity('#FFFFFF', 0.15),
          borderWidth: 1,
          borderColor: opacity('#FFFFFF', 0.2),
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
