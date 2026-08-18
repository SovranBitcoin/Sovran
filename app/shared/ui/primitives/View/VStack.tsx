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

/**
 * Vertical flex stack.
 *
 * `align` / `justify` / `wrap` deliberately have **no defaults**. They used to
 * default to `'stretch'` / `'flex-start'` / `'nowrap'` — which are Yoga's own
 * defaults, so writing them changed nothing visually, but it did put a concrete
 * value into the `style` object on every render. Uniwind renders
 * `style={[classNameStyle, props.style]}`, and later entries win in React
 * Native, so those restated defaults silently overrode any `items-*`,
 * `justify-*` or `flex-wrap` class a caller passed. Leaving them undefined lets
 * Yoga apply the same defaults *and* lets a className take effect.
 */
const VStack = React.forwardRef<any, VStackProps>((props, ref) => {
  const {
    gap,
    align,
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
      flexDirection: 'column' as const,
      ...(align !== undefined && { alignItems: align }),
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

VStack.displayName = 'VStack';

export { VStack };
