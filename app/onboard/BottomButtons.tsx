import React from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  TextStyle,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { Text } from 'components/common/Text';
import { greys, shades, Theme } from 'helper/colors';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'info' | 'default';

export interface ButtonProps {
  text: string;
  onPress: (event: GestureResponderEvent) => void;
  variant: 'primary' | 'secondary' | 'tertiary' | 'info' | 'default';
  disabled?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  buttonStyle?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

interface BottomButtonsProps {
  buttons: ButtonProps[];
  vertical?: boolean;
  theme: Theme;
  textStyle?: StyleProp<TextStyle>;
  buttonStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

const BottomButtons = ({
  buttons,
  vertical = false,
  theme,
  containerStyle,
  buttonStyle,
  textStyle,
}: BottomButtonsProps) => {
  const styles = createStyles(theme);
  const layout = vertical ? styles.verticalButtons : styles.horizontalButtons;

  return (
    <View style={[styles.bottomButtons, layout, containerStyle]}>
      {buttons.map((button, index) => {
        const isLastButton = index === buttons.length - 1;
        const spacingStyle = getSpacingStyle(vertical, index, isLastButton);

        return (
          <TouchableOpacity
            key={index}
            style={[
              styles.button,
              getButtonStyle(button.variant, theme),
              spacingStyle,
              button.disabled && styles.disabledButton,
              buttonStyle,
              button.buttonStyle,
            ]}
            onPress={button.onPress}
            disabled={button.disabled}>
            {button.leftIcon}
            <Text
              weight="bold"
              size={16}
              style={[
                styles.buttonText,
                button.leftIcon && { marginLeft: 8 },
                button.rightIcon && { marginRight: 8 },
                textStyle,
                button.textStyle,
              ]}>
              {button.text}
            </Text>
            {button.rightIcon}
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

// Helper function to get spacing style based on layout
const getSpacingStyle = (vertical: boolean, index: number, isLastButton: boolean) => {
  if (vertical) {
    return isLastButton ? null : { marginBottom: 12 };
  }

  return {
    flex: 1,
    ...(index % 2 === 0 ? { marginRight: 8 } : { marginLeft: 8 }),
  };
};

// Helper function to get button style based on variant
const getButtonStyle = (variant: ButtonVariant, theme: Theme) => {
  const variantStyles: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: shades[300] },
    secondary: { backgroundColor: greys(theme)[500] },
    tertiary: { backgroundColor: greys(theme)[800] },
    info: { backgroundColor: shades[300] },
    default: { backgroundColor: greys(theme)[800] },
  };

  return variantStyles[variant as ButtonVariant] ?? variantStyles.default;
};

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    bottomButtons: {
      width: '100%',
      padding: 16,
      backgroundColor: greys(theme)[950],
    },
    horizontalButtons: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    verticalButtons: {
      flexDirection: 'column',
    },
    button: {
      padding: 16,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
    },
    buttonText: {
      textAlign: 'center',
    },
    disabledButton: {
      opacity: 0.5,
    },
  });

export default BottomButtons;
