import React, { FC } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  StyleProp,
  TextStyle,
} from 'react-native';
import { useThemeColor } from 'hooks/useThemeColor';
import opacity from 'hex-color-opacity';

/**
 * Custom TextInput component with default styling based on the current theme.
 */
interface TextInputProps extends Omit<RNTextInputProps, 'placeholderTextColor'> {
  style?: StyleProp<TextStyle>;
  placeholderTextColor?: string;
}

const TextInput: FC<TextInputProps> = ({ style, placeholderTextColor, ...props }) => {
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  return (
    <RNTextInput
      className="border-default bg-surface-secondary text-foreground mb-0 rounded-[32px] border p-2.5 pl-4 font-bold"
      style={[
        {
          shadowColor: background,
          shadowOffset: { width: 1, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          fontFamily: 'OverpassBold',
          borderStyle: 'solid',
        },
        style,
      ]}
      placeholderTextColor={placeholderTextColor || opacity(foreground, 0.5)}
      {...props}
    />
  );
};

export default React.memo(TextInput);
