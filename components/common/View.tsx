import React from 'react';
import { View as DefaultView, View as RNView } from 'react-native';

export type ViewProps = ThemeProps & DefaultView['props'];

const ViewComponent = React.forwardRef<RNView, ViewProps>(function ViewComponent(props, ref) {
  const { style, ...otherProps } = props;

  return <RNView style={[style]} ref={ref} {...otherProps} />;
});

export const Spacer = ({ size }) => {
  return (
    <ViewComponent
      style={{
        height: size,
      }}
    />
  );
};

export { ViewComponent as View };
