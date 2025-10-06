import React, { useState } from 'react';
import { View, TouchableOpacity, GestureResponderEvent } from 'react-native';
import { Text } from 'components/ui/Text';
import { HStack, VStack } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';

const RouteA = ({ router }: RouteScreenProps<'button-handler', 'route-a'>) => {
  const { getPrimaryColor, getRedColor } = useTheme();
  const payload = useSheetPayload('button-handler');

  const [processingButtonIndex, setProcessingButtonIndex] = useState<number>();

  const handleButtonPress = (
    onPress: (close: (event: GestureResponderEvent) => void) => Promise<void>,
    index: number
  ) => {
    setProcessingButtonIndex(index);

    // Call the original onPress function
    const result = onPress(() => {
      router?.goBack();
    });

    // If it's a promise, reset the processing state when it resolves or rejects
    if (result && typeof result.then === 'function') {
      result.finally(() => {
        setProcessingButtonIndex(undefined);
        // router?.close();
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
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
        borderRadius: 16,
        overflow: 'hidden',
        backgroundColor: getPrimaryColor('800'),
      }}>
      <VStack
        style={{
          backgroundColor: getPrimaryColor('700'),
          padding: 16,
          borderRadius: 16,
        }}>
        {reorderedButtons.map((button, i) => {
          const isProcessing = processingButtonIndex !== undefined;
          const isDisabled = button.disabled || (isProcessing && processingButtonIndex !== i);
          const isDangerous = button.variant === 'dangerous';

          return (
            <TouchableOpacity
              testID={button.testID}
              key={i}
              style={{
                opacity: isDisabled ? 0.5 : 1,
                marginBottom: i === payload.buttons.length - 1 ? 0 : 32,
              }}
              onPress={() => handleButtonPress(button.onPress, i)}
              disabled={isDisabled}>
              <HStack align="center" spacing={16}>
                <View
                  style={{
                    backgroundColor: opacity(getPrimaryColor('400'), 0.25),
                    borderRadius: 1000,
                    padding: 4,
                  }}>
                  {button.icon && (
                    <Icon
                      color={isDangerous ? getRedColor('300') : getPrimaryColor('0')}
                      name={button.icon}
                      size={32}
                    />
                  )}
                </View>
                <Text
                  style={{
                    color: isDangerous ? getRedColor('300') : getPrimaryColor('0'),
                  }}
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
