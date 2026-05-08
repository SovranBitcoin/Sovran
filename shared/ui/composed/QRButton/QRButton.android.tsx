import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  measure,
  runOnJS,
  runOnUI,
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

const WHITE = '#FFFFFF';

export function QRButton(props: QRButtonProps): React.ReactElement {
  const [surfaceTertiary] = useThemeColor(['surface-tertiary'] as const);
  const { onPress, size = DEFAULT_SIZE } = props;

  const borderRadius = size * 0.18;
  const glow = { color: WHITE, opacity: 0.6, radius: 10, offset: { width: 0, height: 0 } };

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
    // Worklet path — UI-thread, syncs with frame.
    runOnUI(() => {
      'worklet';
      const m = measure(animatedRef);
      if (m === null || !m.width || !m.height) return;
      runOnJS(setQRButtonAnchor)({
        x: m.pageX,
        y: m.pageY,
        width: m.width,
        height: m.height,
        borderRadius,
      });
      runOnJS(initLog)(
        'QRButtonAnchor',
        `measure(UI) — pageX=${m.pageX} pageY=${m.pageY} width=${m.width} height=${m.height}`
      );
    })();
    // JS-thread fallback for the Fabric quirk where measure() returns null.
    // Same coord space; the store dedupes redundant publishes.
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
          <View style={[styles.container, containerStyle]} pointerEvents="none">
            <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#0f0f12' }]} />
            <View
              style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(WHITE, 0.35) }]}
            />
            <LinearGradient
              colors={[WHITE, opacity(WHITE, 0.8), opacity(WHITE, 0.7), opacity(WHITE, 0.6)]}
              locations={[0, 0.35, 0.6, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
            <View
              style={[
                StyleSheet.absoluteFillObject,
                { borderWidth: 1, borderColor: opacity(WHITE, 0.4) },
              ]}
            />
          </View>
          <View
            style={[
              StyleSheet.absoluteFillObject,
              { justifyContent: 'center', alignItems: 'center' },
            ]}
            pointerEvents="none">
            <Icon name="stash:qr-code" size={38} color={surfaceTertiary} />
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
