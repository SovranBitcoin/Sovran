import React from 'react';
import { TextInput as RNTextInput } from 'react-native';
import TextInputBase from './TextInputBase';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { store } from 'helper/redux/store';

const TextInput = (props) => {
  const theme = memoizedGetTheme(store.getState());
  return (
    <TextInputBase placeholderTextColor={greys(theme)[600]} {...props} Component={RNTextInput} />
  );
};

export default TextInput;
