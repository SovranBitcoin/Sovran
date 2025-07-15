import React, { useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, reds } from 'helper/colors';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { RouteScreenProps, useSheetPayload } from 'react-native-actions-sheet';

const RouteA = ({ router }: RouteScreenProps<'button-handler', 'route-a'>) => {
  const theme = useSelector(memoizedGetTheme);
  const payload = useSheetPayload('button-handler');

  const [processingButtonIndex, setProcessingButtonIndex] = useState(null);

  const handleButtonPress = (onPress, index) => {
    setProcessingButtonIndex(index);

    // Call the original onPress function
    const result = onPress(() => {
      router?.goBack();
    });

    // If it's a promise, reset the processing state when it resolves or rejects
    if (result && typeof result.then === 'function') {
      result.finally(() => {
        setProcessingButtonIndex(null);
        // router?.close();
      });
    } else {
      setProcessingButtonIndex(null);
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
        backgroundColor: greys(theme)[800],
      }}>
      <View
        style={{
          backgroundColor: greys(theme)[700],
          padding: 16,
          borderRadius: 16,
        }}>
        {reorderedButtons.map((button, i) => {
          const isProcessing = processingButtonIndex !== null;
          const isDisabled = isProcessing && processingButtonIndex !== i;
          const isDangerous = button.variant === 'dangerous';

          return (
            <TouchableOpacity
              testID={button.testID}
              key={i}
              style={{
                justifyContent: 'flex-start',
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: i === payload.buttons.length - 1 ? 0 : 32,
                opacity: isDisabled ? 0.5 : 1,
              }}
              onPress={() => handleButtonPress(button.onPress, i)}
              disabled={isDisabled}>
              <View
                style={{
                  backgroundColor: opacity(greys(theme)[400], 0.25),
                  borderRadius: 1000,
                  padding: 4,
                }}>
                {button.icon && (
                  <Icon
                    color={isDangerous ? reds[300] : greys(theme)[0]}
                    name={button.icon}
                    size={32}
                  />
                )}
              </View>
              <Text
                style={{
                  marginLeft: 16,
                  color: isDangerous ? reds[300] : greys(theme)[0],
                }}
                size={18}
                weight="bold">
                {button.text}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

export default RouteA;
