/**
 * @fileoverview ButtonHandlerContent - Dynamic button action interface
 *
 * @description
 * Displays dynamic button actions with processing states and custom styling.
 * Supports async operations, button reordering (Next buttons last), and
 * disabled states during processing.
 *
 * **Flow:** Display buttons → user selects → execute action → close
 */

import React, { useState } from 'react';
import { GestureResponderEvent } from 'react-native';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import type { ActionSheetPayloads } from '@/shared/lib/popup';

interface ButtonHandlerContentProps {
  payload: ActionSheetPayloads['button-handler'];
  close: () => void;
}

export function ButtonHandlerContent({ payload, close }: ButtonHandlerContentProps) {
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);
  const [processingButtonIndex, setProcessingButtonIndex] = useState<number>();

  const handleButtonPress = (
    onPress: (close: (event: GestureResponderEvent) => void) => Promise<void>,
    index: number
  ) => {
    setProcessingButtonIndex(index);

    const result = onPress(() => {
      close();
    });

    if (result && typeof result.then === 'function') {
      result.finally(() => {
        setProcessingButtonIndex(undefined);
      });
    } else {
      setProcessingButtonIndex(undefined);
      close();
    }
  };

  const reorderedButtons = [
    ...payload.buttons.filter((button) => button.text !== 'Next'),
    ...payload.buttons.filter((button) => button.text === 'Next'),
  ];

  return (
    <View className="bg-surface-secondary mx-4 mb-0 overflow-hidden rounded-2xl">
      <VStack className="bg-surface-tertiary rounded-2xl p-4">
        {reorderedButtons.map((button, i) => {
          const isProcessing = processingButtonIndex !== undefined;
          const isDisabled = button.disabled || (isProcessing && processingButtonIndex !== i);
          const isDangerous = button.variant === 'dangerous';

          return (
            <TouchableOpacity
              testID={button.testID}
              key={i}
              className={`${isDisabled ? 'opacity-50' : ''} ${i < payload.buttons.length - 1 ? 'mb-8' : ''}`}
              onPress={() => handleButtonPress(button.onPress, i)}
              disabled={isDisabled}>
              <HStack align="center" spacing={16}>
                <View
                  className="rounded-full p-1"
                  style={{ backgroundColor: opacity(muted, 0.25) }}>
                  {button.icon && (
                    <Icon color={isDangerous ? danger : foreground} name={button.icon} size={32} />
                  )}
                </View>
                <Text
                  className={isDangerous ? 'text-danger' : 'text-foreground'}
                  size={18}
                  weight="bold">
                  {button.text}
                </Text>
              </HStack>
            </TouchableOpacity>
          );
        })}
      </VStack>
    </View>
  );
}
