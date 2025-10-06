import React, { FC, ComponentType } from 'react';
import { StyleProp, TextStyle } from 'react-native';
import { useTheme } from 'providers/ThemeProvider';

interface TextInputBaseProps {
  Component: ComponentType<any>;
  style?: StyleProp<TextStyle>;
  [key: string]: any;
}

const TextInputBase: FC<TextInputBaseProps> = ({ Component, style, ...props }) => {
  const { getPrimaryColor } = useTheme();

  // Instead of creating styles in each render, we can use inline styles
  // according to the refactoring guidelines
  return (
    <Component
      style={[
        {
          backgroundColor: getPrimaryColor('800'),
          borderWidth: 1,
          borderColor: getPrimaryColor('600'),
          shadowColor: getPrimaryColor('950'),
          shadowOffset: { width: 1, height: 4 },
          shadowOpacity: 0.25,
          shadowRadius: 6,
          borderRadius: 32,
          padding: 10,
          color: getPrimaryColor('0'),
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
