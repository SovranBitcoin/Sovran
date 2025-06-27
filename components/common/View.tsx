import { BlurTint, BlurView } from 'expo-blur';
import React from 'react';
import { View as RNView, ViewProps as RNViewProps, StyleSheet } from 'react-native';

type Props = RNViewProps & {
  blur?: boolean;
  blurIntensity?: number;
  blurTint?: BlurTint;
  children?: React.ReactNode;
};

export const View = React.forwardRef<RNView, Props>((props, ref) => {
  const {
    blur = false,
    blurIntensity = 60,
    blurTint = 'prominent',
    style,
    children,
    ...rest
  } = props;

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
      <BlurView intensity={blurIntensity} tint={blurTint} style={StyleSheet.absoluteFill} />
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
