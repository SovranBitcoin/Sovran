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

const DEFAULT_SIZE = 72;

const BUTTON_COLOR = '#FFFFFF';

export function QRButton(props: QRButtonProps): React.ReactElement {
  const [background, surfaceForeground] = useThemeColor([
    'background',
    'surface-foreground',
  ] as const);
  const { onPress, accentColor = BUTTON_COLOR, size = DEFAULT_SIZE } = props;

  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 1,
    borderColor: opacity(BUTTON_COLOR, 0.4),
  };

  const animatedRef = useAnimatedRef<Animated.View>();
  const morphCompleted = useBootMorphCompleted();
  const visibility = useSharedValue(morphCompleted ? 1 : 0);
  const visibilityStyle = useAnimatedStyle(() => ({ opacity: visibility.value }));

  const publishAnchor = useCallback(() => {
    const targetRadius = containerStyle.borderRadius;
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
        borderRadius: targetRadius,
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
      setQRButtonAnchor({ x, y, width: w, height: h, borderRadius: targetRadius });
      initLog(
        'QRButtonAnchor',
        `measureInWindow(JS) — x=${x} y=${y} width=${w} height=${h}`
      );
    });
  }, [animatedRef, containerStyle.borderRadius]);

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
        style={[styles.touchable, { ...containerStyle, shadowColor: accentColor }]}
        className="items-center justify-center"
        haptics={{ type: 'impact', impactStyle: 'light' }}
        activeOpacity={0.75}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        onPress={onPress}>
        <View style={[styles.container, containerStyle]} pointerEvents="none">
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: background }]} />
          <View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: opacity(BUTTON_COLOR, 0.3) }]}
          />
          <LinearGradient
            colors={[
              opacity(BUTTON_COLOR, 0.7),
              opacity(BUTTON_COLOR, 0.4),
              opacity(BUTTON_COLOR, 0.15),
              'transparent',
            ]}
            locations={[0, 0.25, 0.6, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={[
              opacity(BUTTON_COLOR, 0.5),
              opacity(BUTTON_COLOR, 0.2),
              'transparent',
              opacity(BUTTON_COLOR, 0.25),
            ]}
            locations={[0, 0.3, 0.65, 1]}
            start={{ x: 1, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
          <LinearGradient
            colors={[opacity(surfaceForeground, 0.08), 'transparent']}
            locations={[0, 0.65]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        </View>
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { justifyContent: 'center', alignItems: 'center' },
          ]}
          pointerEvents="none">
          <Icon name="stash:qr-code" size={24} color={surfaceForeground} />
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
