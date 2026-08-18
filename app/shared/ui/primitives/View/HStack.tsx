import React from 'react';
import { FlexStyle, DimensionValue, StyleSheet } from 'react-native';
import { View, ViewProps } from './View';
import { supportsBlur } from '@/shared/lib/version';

type HStackProps = ViewProps & {
  gap?: number;
  align?: FlexStyle['alignItems'];
  justify?: FlexStyle['justifyContent'];
  flex?: number;
  wrap?: FlexStyle['flexWrap'];
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: DimensionValue;
};

const HStack = React.forwardRef<any, HStackProps>((props, ref) => {
  const {
    gap,
    align = 'center',
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
      flexDirection: 'row' as const,
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

HStack.displayName = 'HStack';

export { HStack };
