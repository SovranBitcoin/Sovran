import { BlurTint, BlurView } from 'expo-blur';
import React from 'react';
import { View as RNView, ViewProps as RNViewProps, StyleSheet, FlexStyle } from 'react-native';
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
  const { backgroundColor, ...cleanStyle } = flattenedStyle || {};

  if (!blur || !image) {
    // 🔁 Normal unwrapped View – identical to before
    return (
      <RNView ref={ref} style={style} {...rest}>
        {children}
      </RNView>
    );
  }

  // 🧊 Blur-enhanced View
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
  align?: FlexStyle['alignItems'];
  justify?: FlexStyle['justifyContent'];
  flex?: number;
  wrap?: FlexStyle['flexWrap'];
};

const VStack = React.forwardRef<any, StackProps>((props, ref) => {
  const {
    spacing = 0,
    align = 'stretch',
    justify = 'flex-start',
    flex,
    wrap = 'nowrap',
    style,
    children,
    ...rest
  } = props;

  const stackStyle = [
    {
      flexDirection: 'column' as const,
      alignItems: align,
      justifyContent: justify,
      flex: flex,
      flexWrap: wrap,
    },
    style,
  ];

  const processedChildren = React.Children.map(children, (child, index) => {
    if (!React.isValidElement(child)) return child;

    // Add spacing except for the last child
    const isLastChild = index === React.Children.count(children) - 1;
    if (spacing > 0 && !isLastChild) {
      return (
        <React.Fragment key={index}>
          {child}
          <View style={{ height: spacing }} />
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
    align = 'center',
    justify = 'flex-start',
    flex,
    wrap = 'nowrap',
    style,
    children,
    ...rest
  } = props;

  const stackStyle = [
    {
      flexDirection: 'row' as const,
      alignItems: align,
      justifyContent: justify,
      flex: flex,
      flexWrap: wrap,
    },
    style,
  ];

  const processedChildren = React.Children.map(children, (child, index) => {
    if (!React.isValidElement(child)) return child;

    // Add spacing except for the last child
    const isLastChild = index === React.Children.count(children) - 1;
    if (spacing > 0 && !isLastChild) {
      return (
        <React.Fragment key={index}>
          {child}
          <View style={{ width: spacing }} />
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
