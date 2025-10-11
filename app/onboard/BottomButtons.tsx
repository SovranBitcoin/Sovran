import React from 'react';
import {
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
  const Stack = vertical ? VStack : HStack;
  const spacing = vertical ? 12 : 8;

  const getButtonVariantClass = (variant: ButtonVariant) => {
    const variantClasses: Record<ButtonVariant, string> = {
      primary: 'bg-shade-300',
      secondary: 'bg-primary-500',
      tertiary: 'bg-primary-800',
      info: 'bg-shade-300',
      default: 'bg-primary-800',
    };
    return variantClasses[variant] || variantClasses.default;
  };

  return (
    <Stack
      spacing={spacing}
      justify={vertical ? 'flex-start' : 'space-between'}
      className="w-full bg-primary-950 p-4"
      style={containerStyle}>
      {buttons.map((button, index) => (
        <TouchableOpacity
          key={index}
          className={`rounded-2xl p-4 ${getButtonVariantClass(button.variant)} ${
            !vertical ? 'flex-1' : ''
          } ${button.disabled ? 'opacity-50' : ''}`}
          style={[
            getButtonStyle(button.variant, getPrimaryColor, getShadeColor),
            buttonStyle,
            button.buttonStyle,
          ]}
          onPress={button.onPress}
          disabled={button.disabled}>
          <HStack align="center" spacing={8}>
            {button.leftIcon}
            <Text
              weight="bold"
              size={16}
              className="text-center"
              style={[textStyle, button.textStyle]}>
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

export default BottomButtons;
