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

/**
 * Horizontal flex stack.
 *
 * `align` keeps its `'center'` default — that is a real choice, not Yoga's
 * (`'stretch'`), and every caller relies on it. `justify` and `wrap` had
 * defaults that merely restated Yoga's own, and because Uniwind renders
 * `style={[classNameStyle, props.style]}` — later wins in React Native — those
 * restatements silently overrode any `justify-*` or `flex-wrap` class a caller
 * passed. They are gone; Yoga applies the same values, and a className now
 * takes effect.
 *
 * An `items-*` class is still overridden by the `align` default. Pass the
 * `align` prop for that one.
 */
const HStack = React.forwardRef<any, HStackProps>((props, ref) => {
  const {
    gap,
    align = 'center',
    justify,
    flex,
    flexGrow,
    flexShrink,
    flexBasis,
    wrap,
    style,
    children,
    className,
    blur,
    ...rest
  } = props;

  // Only the properties the caller actually set are written. A key present with
  // an `undefined` value still wins: React Native's `flattenStyle` copies every
  // own key, and Uniwind renders `style={[classNameStyle, props.style]}`, so an
  // `undefined` here would blank out whatever the className resolved to.
  const stackStyle = StyleSheet.flatten([
    {
      flexDirection: 'row' as const,
      alignItems: align,
      ...(justify !== undefined && { justifyContent: justify }),
      ...(wrap !== undefined && { flexWrap: wrap }),
      ...(flex !== undefined && { flex }),
      ...(flexGrow !== undefined && { flexGrow }),
      ...(flexShrink !== undefined && { flexShrink }),
      ...(flexBasis !== undefined && { flexBasis }),
      ...(gap !== undefined && { gap }),
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
