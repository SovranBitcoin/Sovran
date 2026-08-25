import React from 'react';
import { FlexStyle, DimensionValue, StyleSheet, View as RNView } from 'react-native';
import { View, ViewProps } from './View';
import { supportsBlur } from '@/shared/lib/version';

export type StackProps = ViewProps & {
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
 * Shared implementation behind `HStack` / `VStack` — those modules own the
 * public defaults (and the rationale for them); this one owns the rendering.
 *
 * Flex props are optional and deliberately undefaulted here: Yoga's own
 * defaults apply when a prop is absent, and a className can then take effect
 * (Uniwind renders `style={[classNameStyle, props.style]}`, later wins).
 */
const Stack = React.forwardRef<RNView, StackProps & { direction: 'row' | 'column' }>(
  (props, ref) => {
    const {
      direction,
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
        flexDirection: direction,
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
  }
);

Stack.displayName = 'Stack';

export { Stack };
