import React from 'react';
import opacity from 'hex-color-opacity';

import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useFiatCurrencyPill, type FiatCurrencyPillProps } from './useFiatCurrencyPill';

export function FiatCurrencyPillFlat(props: FiatCurrencyPillProps): React.ReactElement {
  const { text, success, green400, green500, iosHeight, onPress, textSize } =
    useFiatCurrencyPill(props);

  return (
    <Pressable disabled={!onPress} onPress={onPress}>
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
