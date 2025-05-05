import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { SheetProvider, useSheetRouter } from 'react-native-actions-sheet';
import { Text } from 'components/common/Themed';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys, shades } from 'helper/colors';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';

const RouteA = ({ router, payload }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
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
        backgroundColor: greys(theme)[1800],
      }}>
      <View
        style={{
          backgroundColor: greys(theme)[1500],
          padding: 16,
          borderRadius: 16,
        }}>
        {reorderedButtons.map((button, i) => {
          const isProcessing = processingButtonIndex !== null;
          const isDisabled = isProcessing && processingButtonIndex !== i;

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
                  backgroundColor: opacity(greys(theme)[700], 0.25),
                  borderRadius: 1000,
                  padding: 4,
                }}>
                <Icon color={greys(theme)[0]} name={button.icon} size={32} />
              </View>
              <Text
                style={{
                  marginLeft: 16,
                  color: greys(theme)[0],
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

const createStyles = (theme: string) =>
  StyleSheet.create({
    headerText: {
      fontFamily: 'OverpassBold',
      textAlign: 'center',
      marginTop: 16,
      color: shades[500],
      fontSize: 16,
    },
    contentContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: 40,
      position: 'absolute',
      left: 0,
      right: 0,
      top: '50%',
      transform: [
        {
          translateY: '-150%',
        },
      ],
    },
    iconButton: {
      position: 'absolute',
      top: 0,
      zIndex: 10,
    },
    iconBackground: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: shades[500],
      alignItems: 'center',
      justifyContent: 'center',
      elevation: 5,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.25,
      shadowRadius: 3.84,
    },
    pulseCircle: {
      position: 'absolute',
      width: 100,
      height: 100,
      top: 0,
      borderRadius: 50,
      backgroundColor: shades[400],
    },
    statusText: {
      marginTop: 24,
      color: greys(theme)[2300],
      fontFamily: 'OverpassMedium',
      fontSize: 16,
    },
    cancelButton: {
      marginTop: 20,
      width: 150,
    },
  });

export default RouteA;
