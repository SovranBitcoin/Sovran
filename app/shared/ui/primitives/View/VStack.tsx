import React from 'react';
import { FlexStyle, DimensionValue, StyleSheet } from 'react-native';
import { View, ViewProps } from './View';
import { supportsBlur } from '@/shared/lib/version';

type VStackProps = ViewProps & {
  gap?: number;
  align?: FlexStyle['alignItems'];
  justify?: FlexStyle['justifyContent'];
  flex?: number;
  wrap?: FlexStyle['flexWrap'];
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: DimensionValue;
};

const VStack = React.forwardRef<any, VStackProps>((props, ref) => {
  const {
    gap,
    align = 'stretch',
    justify = 'flex-start',
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    wrap = 'nowrap',
    style,
    children,
    className,
    blur,
    ...rest
  } = props;

  const stackStyle = StyleSheet.flatten([
    {
      flexDirection: 'column' as const,
      alignItems: align,
      justifyContent: justify,
      flex,
      flexGrow,
      flexShrink,
      flexBasis,
      flexWrap: wrap,
      gap,
    },
    style,
  ]);

  const effectiveBlur = blur && supportsBlur();
  const cleanClassName = effectiveBlur ? className?.replace(/bg-\S+/g, '').trim() : className;

  return (
    <View ref={ref} style={stackStyle} className={cleanClassName} blur={effectiveBlur} {...rest}>
      {children}
    </View>
  );
});

VStack.displayName = 'VStack';

export { VStack };
