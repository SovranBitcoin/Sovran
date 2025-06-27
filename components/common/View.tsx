import { BlurTint, BlurView } from 'expo-blur';
import React from 'react';
import { View as RNView, ViewProps as RNViewProps, StyleSheet } from 'react-native';
import { useSelector } from 'react-redux';
import { memoizedGetBackgroundImageAttrs } from 'helper/redux/settings';

type Props = RNViewProps & {
  blur?: boolean;
  blurIntensity?: number;
  blurTint?: BlurTint;
  children?: React.ReactNode;
};

export const View = React.forwardRef<RNView, Props>((props, ref) => {
  const globalAttrs = useSelector(memoizedGetBackgroundImageAttrs);

  const {
    blur = false,
    blurIntensity = 60,
    blurTint,
    style,
    children,
    ...rest
  } = props;

  const effectiveTint = blurTint || globalAttrs?.tint || 'prominent';

  if (!blur) {
    // 🔁 Normal unwrapped View – identical to before
    return (
      <RNView ref={ref} style={style} {...rest}>
        {children}
      </RNView>
    );
  }

  // 🧊 Blur-enhanced View
  return (
    <RNView ref={ref} style={[style, styles.overflowHidden]} {...rest}>
      <BlurView intensity={blurIntensity} tint={effectiveTint} style={StyleSheet.absoluteFill} />
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
