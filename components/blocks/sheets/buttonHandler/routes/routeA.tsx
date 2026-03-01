/**
 * @fileoverview RouteA - Dynamic button action interface
 *
 * @module components/blocks/sheets/buttonHandler/routes/route-a
 *
 * @description
 * Displays dynamic button actions with processing states and custom styling.
 * Supports async operations, button reordering (Next buttons last), and
 * disabled states during processing. Handles both sync and async button actions.
 *
 * **Navigation:**
 * - From: Initial route (sheet opens here)
 * - To: Closes after button action execution
 * - Close: `router?.goBack()` or `router?.close()`
 *
 * **Data:**
 * - Payload: `useSheetPayload('button-handler')` - Button configuration array
 * - Params: None (single route)
 *
 * **Flow:** Display buttons → user selects → execute action → close
 *
 * @see {@link ./index}
 */

import React, { useState } from 'react';
import { GestureResponderEvent } from 'react-native';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { useThemeColor } from 'hooks/useThemeColor';

const RouteA = ({ router }: RouteScreenProps<'button-handler', 'route-a'>) => {
  const [foreground, muted, danger] = useThemeColor(['foreground', 'muted', 'danger'] as const);
  const payload = useSheetPayload('button-handler');
  const [processingButtonIndex, setProcessingButtonIndex] = useState<number>();

  const handleButtonPress = (
    onPress: (close: (event: GestureResponderEvent) => void) => Promise<void>,
    index: number
  ) => {
    setProcessingButtonIndex(index);

    const result = onPress(() => {
      router?.goBack();
    });

    if (result && typeof result.then === 'function') {
      result.finally(() => {
        setProcessingButtonIndex(undefined);
      });
    } else {
      setProcessingButtonIndex(undefined);
      router?.close();
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
};

export default RouteA;
