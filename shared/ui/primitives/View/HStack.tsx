import React from 'react';
import { FlexStyle, DimensionValue, StyleSheet } from 'react-native';
import { View, ViewProps } from './View';
import { supportsBlur } from '@/shared/lib/version';

type HStackProps = ViewProps & {
  /** @deprecated use `gap` */
  spacing?: number;
  gap?: number;
  align?: FlexStyle['alignItems'];
  justify?: FlexStyle['justifyContent'];
  flex?: number;
  wrap?: FlexStyle['flexWrap'];
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: DimensionValue;
};

const HStack = React.forwardRef<React.ElementRef<typeof View>, HStackProps>((props, ref) => {
  const {
    spacing,
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

  const resolvedGap = gap ?? spacing;

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
      gap: resolvedGap,
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
