import React from 'react';
import {
  StyleSheet,
  TouchableOpacity,
  TextStyle,
  StyleProp,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import { Text } from 'components/ui/Text';
import { VStack, HStack } from 'components/ui/View';
import { useTheme } from 'providers/ThemeProvider';

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
  textStyle?: StyleProp<TextStyle>;
  buttonStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}

const BottomButtons = ({
  buttons,
  vertical = false,
  containerStyle,
  buttonStyle,
  textStyle,
}: BottomButtonsProps) => {
  const { getPrimaryColor, getShadeColor } = useTheme();
  const styles = createStyles(getPrimaryColor);
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
            getButtonStyle(button.variant, getPrimaryColor, getShadeColor),
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
const getButtonStyle = (
  variant: ButtonVariant,
  getPrimaryColor: (shade: string) => string,
  getShadeColor: (shade: string) => string
) => {
  const variantStyles: Record<ButtonVariant, ViewStyle> = {
    primary: { backgroundColor: getShadeColor('300') },
    secondary: { backgroundColor: getPrimaryColor('500') },
    tertiary: { backgroundColor: getPrimaryColor('800') },
    info: { backgroundColor: getShadeColor('300') },
    default: { backgroundColor: getPrimaryColor('800') },
  };

  return variantStyles[variant as ButtonVariant] ?? variantStyles.default;
};

const createStyles = (getPrimaryColor: (shade: string) => string) =>
  StyleSheet.create({
    bottomButtons: {
      width: '100%',
      padding: 16,
      backgroundColor: getPrimaryColor('950'),
    },
    button: {
      padding: 16,
      borderRadius: 16,
    },
    buttonText: {
      textAlign: 'center',
    },
    disabledButton: {
      opacity: 0.5,
    },
  });

export default BottomButtons;
