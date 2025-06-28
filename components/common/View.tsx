import { BlurTint, BlurView } from 'expo-blur';
import React from 'react';
import { View as RNView, ViewProps as RNViewProps, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { BACKGROUND_IMAGE_ATTRIBUTES } from 'helper/backgroundImages';
import { memoizedGetBackgroundImage } from 'helper/redux/settings';

type Props = RNViewProps & {
  blur?: boolean;
  colorBlur?: string;
  blurIntensity?: number;
  blurTint?: BlurTint;
  children?: React.ReactNode;
};

export const View = React.forwardRef<RNView, Props>((props, ref) => {
  const image = useSelector(memoizedGetBackgroundImage);

  const { blur = false, blurIntensity = 70, blurTint, style, children, ...rest } = props;

  const effectiveTint = blurTint || BACKGROUND_IMAGE_ATTRIBUTES[image]?.tint || 'prominent';

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
    <RNView ref={ref} style={[cleanStyle, styles.overflowHidden]} {...rest}>
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

const styles = StyleSheet.create({
  overflowHidden: {
    overflow: 'hidden',
  },
});

export const Spacer = ({ size }) => {
  return (
    <View
      style={{
        height: size,
      }}
    />
  );
};

export { View };
