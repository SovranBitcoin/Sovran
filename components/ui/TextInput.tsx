import React, { FC } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  StyleProp,
  TextStyle,
} from 'react-native';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';

/**
 * Custom TextInput component with default styling based on the current theme.
 */
interface TextInputProps extends Omit<RNTextInputProps, 'placeholderTextColor'> {
  style?: StyleProp<TextStyle>;
  placeholderTextColor?: string;
}

const TextInput: FC<TextInputProps> = ({ style, placeholderTextColor, ...props }) => {
  const { getPrimaryColor } = useTheme();

  return (
    <RNTextInput
      className="mb-0 rounded-[32px] border border-primary-600 bg-primary-800 p-2.5 pl-4 font-bold text-primary-0"
      style={[
        {
          shadowColor: getPrimaryColor('950'),
          shadowOffset: { width: 1, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          fontFamily: 'OverpassBold',
          borderStyle: 'solid',
        },
        style,
      ]}
      placeholderTextColor={placeholderTextColor || opacity(getPrimaryColor('0'), 0.5)}
      {...props}
    />
  );
};

export default React.memo(TextInput);
