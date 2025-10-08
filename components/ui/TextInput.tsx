import React, { FC } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  StyleProp,
  TextStyle,
} from 'react-native';
import { useTheme } from 'providers/ThemeProvider';

/**
 * Custom TextInput component with default styling based on the current theme.
 */
export interface TextInputProps extends Omit<RNTextInputProps, 'placeholderTextColor'> {
  style?: StyleProp<TextStyle>;
  placeholderTextColor?: string;
}

const TextInput: FC<TextInputProps> = ({ style, placeholderTextColor, ...props }) => {
  const { getPrimaryColor } = useTheme();

  return (
    <RNTextInput
      className="border-primary-600 bg-primary-800 text-primary-0 mb-0 rounded-[32px] border p-2.5 pl-4 font-bold"
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
      placeholderTextColor={placeholderTextColor || getPrimaryColor('300')}
      {...props}
    />
  );
};

export default React.memo(TextInput);
