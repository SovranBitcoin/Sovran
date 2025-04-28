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
  const theme = useSelector((state) => memoizedGetTheme(state));

  // Instead of creating styles in each render, we can use inline styles
  // according to the refactoring guidelines
  return (
    <Component
      style={[
        {
          backgroundColor: greys(theme)[1800],
          borderWidth: 1,
          borderColor: greys(theme)[1300],
          shadowColor: greys(theme)[2300],
          shadowOffset: { width: 1, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          borderRadius: 32,
          padding: 10,
          color: greys(theme)[0],
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
