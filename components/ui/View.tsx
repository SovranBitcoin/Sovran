import { BlurTint, BlurView } from 'expo-blur';
import React from 'react';
import {
  View as RNView,
  ViewProps as RNViewProps,
  StyleSheet,
  FlexStyle,
  DimensionValue,
} from 'react-native';
import { useSelector } from 'react-redux';
import { BACKGROUND_IMAGE_ATTRIBUTES } from 'helper/backgroundImages';
import { memoizedGetBackgroundImage } from 'helper/redux/settings';

type ViewProps = RNViewProps & {
  blur?: boolean;
  colorBlur?: string;
  blurIntensity?: number;
  blurTint?: BlurTint;
  children?: React.ReactNode;
};

const View = React.forwardRef<RNView, ViewProps>((props, ref) => {
  const image = useSelector(memoizedGetBackgroundImage);

  const { blur = false, blurIntensity = 70, blurTint, style, children, ...rest } = props;

  const effectiveTint = blurTint
    ? blurTint
    : image
      ? BACKGROUND_IMAGE_ATTRIBUTES[image]?.tint
      : 'prominent';

  const flattenedStyle = StyleSheet.flatten(style);
  const { backgroundColor: _backgroundColor, ...cleanStyle } = flattenedStyle || {};

  if (!blur) {
    // 🔁 Normal unwrapped View – no blur requested
    return (
      <RNView ref={ref} style={style} {...rest}>
        {children}
      </RNView>
    );
  }

  // 🧊 Blur-enhanced View - works with or without background image
  return (
    <RNView
      ref={ref}
      style={[
        cleanStyle,
        {
          overflow: 'hidden',
        },
      ]}
      {...rest}>
      {rest.colorBlur && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: rest.colorBlur,
            },
          ]}
        />
      )}
      <BlurView intensity={blurIntensity} tint={effectiveTint} style={[StyleSheet.absoluteFill]} />

      {children}
    </RNView>
  );
});

View.displayName = 'View';

const Spacer = ({ size }: { size: number }) => {
  return (
    <View
      style={{
        height: size,
      }}
    />
  );
};

type StackProps = ViewProps & {
  spacing?: number;
  gap?: number;
  align?: FlexStyle['alignItems'];
  justify?: FlexStyle['justifyContent'];
  flex?: number;
  wrap?: FlexStyle['flexWrap'];
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: DimensionValue;
  flexDirection?: FlexStyle['flexDirection'];
};

const VStack = React.forwardRef<any, StackProps>((props, ref) => {
  const {
    spacing = 0,
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
    ...rest
  } = props;

  // Use gap if provided, otherwise fall back to spacing
  const effectiveSpacing = gap !== undefined ? gap : spacing;

  const stackStyle = StyleSheet.flatten([
    {
      flexDirection: 'column' as const,
      alignItems: align,
      justifyContent: justify,
      flex: flex,
      flexGrow: flexGrow,
      flexShrink: flexShrink,
      flexBasis: flexBasis,
      flexWrap: wrap,
    },
    style,
  ]);

  const processedChildren = React.Children.map(children, (child, index) => {
    if (!React.isValidElement(child)) return child;

    // Add spacing except for the last child
    const isLastChild = index === React.Children.count(children) - 1;
    if (effectiveSpacing > 0 && !isLastChild) {
      return (
        <React.Fragment key={index}>
          {child}
          <View style={{ height: effectiveSpacing }} />
        </React.Fragment>
      );
    }

    return child;
  });

  return (
    <View ref={ref} style={stackStyle} {...rest}>
      {processedChildren}
    </View>
  );
});

const HStack = React.forwardRef<any, StackProps>((props, ref) => {
  const {
    spacing = 0,
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
    ...rest
  } = props;

  // Use gap if provided, otherwise fall back to spacing
  const effectiveSpacing = gap !== undefined ? gap : spacing;

  const stackStyle = StyleSheet.flatten([
    {
      flexDirection: 'row' as const,
      alignItems: align,
      justifyContent: justify,
      flex: flex,
      flexGrow: flexGrow,
      flexShrink: flexShrink,
      flexBasis: flexBasis,
      flexWrap: wrap,
    },
    style,
  ]);

  const processedChildren = React.Children.map(children, (child, index) => {
    if (!React.isValidElement(child)) return child;

    // Add spacing except for the last child
    const isLastChild = index === React.Children.count(children) - 1;
    if (effectiveSpacing > 0 && !isLastChild) {
      return (
        <React.Fragment key={index}>
          {child}
          <View style={{ width: effectiveSpacing }} />
        </React.Fragment>
      );
    }

    return child;
  });

  return (
    <View ref={ref} style={stackStyle} {...rest}>
      {processedChildren}
    </View>
  );
});

VStack.displayName = 'VStack';
HStack.displayName = 'HStack';

export { View, Spacer, VStack, HStack };
