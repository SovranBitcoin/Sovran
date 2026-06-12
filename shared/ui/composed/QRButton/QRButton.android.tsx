import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Log, initLog } from '@/shared/lib/logger';
import {
  registerQRButtonRemeasure,
  setQRButtonAnchor,
  useBootMorphCompleted,
} from '@/shared/lib/qrButtonAnchor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

const DEFAULT_SIZE = 64;

export function QRButton(props: QRButtonProps): React.ReactElement {
  // Inverts with the theme: on dark themes the base is the foreground (white)
  // with a soft white gradient and a dark icon; on light themes the base is
  // the foreground (black) with a soft black gradient and a light icon.
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);
  const { onPress, size = DEFAULT_SIZE } = props;

  const borderRadius = size * 0.18;
  const glow = { color: foreground, opacity: 0.6, radius: 10, offset: { width: 0, height: 0 } };

  const containerStyle = {
    width: size,
    height: size,
    borderRadius,
    borderCurve: 'continuous' as const,
    overflow: 'hidden' as const,
  };

  const pressableStyle = {
    ...containerStyle,
    shadowColor: glow.color,
    shadowOffset: glow.offset,
    shadowOpacity: glow.opacity,
    shadowRadius: glow.radius,
    elevation: 5,
  };

  const animatedRef = useAnimatedRef<Animated.View>();
  const morphCompleted = useBootMorphCompleted();
  const visibility = useSharedValue(morphCompleted ? 1 : 0);
  const visibilityStyle = useAnimatedStyle(() => ({ opacity: visibility.value }));

  const publishAnchor = useCallback(() => {
    // Android's UI-thread measurement can report pageX/pageY in a different
    // space than the root view during boot on devices with variable system
    // nav bars. The splash morph consumes window coordinates, so keep this
    // path on measureInWindow only.
    const node = animatedRef.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    } | null;
    node?.measureInWindow?.((x, y, w, h) => {
      if (!w || !h) return;
      setQRButtonAnchor({ x, y, width: w, height: h, borderRadius });
      initLog('QRButtonAnchor', `measureInWindow(JS) — x=${x} y=${y} width=${w} height=${h}`);
    });
  }, [animatedRef, borderRadius]);

  useEffect(() => {
    visibility.value = withTiming(morphCompleted ? 1 : 0, { duration: 180 });
  }, [morphCompleted, visibility]);

  useEffect(() => {
    const unregister = registerQRButtonRemeasure(publishAnchor);
    return () => {
      unregister();
      setQRButtonAnchor(null);
    };
  }, [publishAnchor]);

  return (
    <Log name="QRButton">
      <Animated.View
        ref={animatedRef}
        onLayout={publishAnchor}
        collapsable={false}
        style={[{ width: size, height: size }, visibilityStyle]}>
        <Pressable
          style={[styles.touchable, pressableStyle]}
          className="items-center justify-center"
          haptics={{ type: 'impact', impactStyle: 'light' }}
          activeOpacity={0.75}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          onPress={onPress}>
          <SquircleView style={[styles.container, containerStyle]} pointerEvents="none">
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: background }]} />
            <View
              style={[
                StyleSheet.absoluteFillObject,
                { backgroundColor: opacity(foreground, 0.65) },
              ]}
            />
            <LinearGradient
              colors={[
                foreground,
                opacity(foreground, 0.8),
                opacity(foreground, 0.7),
                opacity(foreground, 0.6),
              ]}
              locations={[0, 0.35, 0.6, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={[
                StyleSheet.absoluteFillObject,
                { borderWidth: 1, borderColor: opacity(foreground, 0.4) },
              ]}
            />
          </SquircleView>
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { justifyContent: 'center', alignItems: 'center' },
            ]}
            pointerEvents="none">
            <Icon name="stash:qr-code" size={38} color={background} />
          </View>
        </Pressable>
      </Animated.View>
    </Log>
  );
}

const styles = StyleSheet.create({
  touchable: {
    borderCurve: 'continuous',
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 8,
    elevation: 5,
  },
  container: {
    overflow: 'hidden',
    position: 'absolute',
  },
});
