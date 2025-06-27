import React, { FC, ComponentType } from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { useSelector } from 'react-redux';
import { greys } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';

interface TextInputBaseProps {
  Component: ComponentType<any>;
  style?: StyleProp<TextStyle>;
  [key: string]: any;
}

const TextInputBase: FC<TextInputBaseProps> = ({ Component, style, ...props }) => {
  const theme = useSelector(memoizedGetTheme);

  // Instead of creating styles in each render, we can use inline styles
  // according to the refactoring guidelines
  return (
    <Component
      style={[
        {
          backgroundColor: theme.greys[1800],
          borderWidth: 1,
          borderColor: theme.greys[1300],
          shadowColor: theme.greys[2300],
          shadowOffset: { width: 1, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          borderRadius: 32,
          padding: 10,
          color: theme.greys[0],
          paddingLeft: 16,
          fontFamily: 'OverpassBold',
          marginBottom: 0,
          borderStyle: 'solid',
        },
        style,
      ]}
      {...props}
    />
  );
};

export default TextInputBase;
