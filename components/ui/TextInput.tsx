import React, { FC } from 'react';
import {
  TextInput as RNTextInput,
  TextInputProps as RNTextInputProps,
  StyleProp,
  TextStyle,
} from 'react-native';
import TextInputBase from './TextInputBase';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useSelector } from 'react-redux';

/**
 * Custom TextInput component that wraps TextInputBase with default styling
 * based on the current theme.
 */
export interface TextInputProps extends Omit<RNTextInputProps, 'placeholderTextColor'> {
  style?: StyleProp<TextStyle>;
  placeholderTextColor?: string;
}

const TextInput: FC<TextInputProps> = ({ style, placeholderTextColor, ...props }) => {
  // Use useSelector hook for theme access to make component reactive to theme changes
  const theme = useSelector(memoizedGetTheme);

  return (
    <TextInputBase
      Component={RNTextInput}
      style={style}
      placeholderTextColor={placeholderTextColor || greys(theme)[300]}
      {...props}
    />
  );
};

export default React.memo(TextInput);
