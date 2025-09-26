import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  TextStyle,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { Text } from 'components/common/Text';
import { VStack, HStack } from 'components/common/View';
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
  const Stack = vertical ? VStack : HStack;
  const spacing = vertical ? 12 : 8;

  return (
    <Stack
      spacing={spacing}
      justify={vertical ? 'flex-start' : 'space-between'}
      style={[styles.bottomButtons, containerStyle]}>
      {buttons.map((button, index) => (
        <TouchableOpacity
          key={index}
          style={[
            styles.button,
            getButtonStyle(button.variant, theme),
            !vertical && { flex: 1 },
            button.disabled && styles.disabledButton,
            buttonStyle,
            button.buttonStyle,
          ]}
          onPress={button.onPress}
          disabled={button.disabled}>
          <HStack align="center" spacing={8}>
            {button.leftIcon}
            <Text weight="bold" size={16} style={[styles.buttonText, textStyle, button.textStyle]}>
              {button.text}
            </Text>
            {button.rightIcon}
          </HStack>
        </TouchableOpacity>
      ))}
    </Stack>
  );
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
    button: {
      padding: 16,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
    },
    buttonText: {
      textAlign: 'center',
    },
    disabledButton: {
      opacity: 0.5,
    },
  });

export default BottomButtons;
