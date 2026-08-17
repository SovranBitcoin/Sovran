import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableFeedback } from 'heroui-native';
import Animated, { measure, runOnJS, runOnUI, useAnimatedRef } from 'react-native-reanimated';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Log, initLog } from '@/shared/lib/logger';
import { registerQRButtonRemeasure, setQRButtonAnchor } from '@/shared/lib/qrButtonAnchor';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useQRButtonPressFeedback } from './useQRButtonPressFeedback';
import { useQRButtonReveal } from './useQRButtonReveal';

interface QRButtonProps {
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
  const visibilityStyle = useQRButtonReveal();
  const pressFeedback = useQRButtonPressFeedback();

  const publishAnchor = useCallback(() => {
    // Try the worklet path first — UI-thread measurement, syncs with frame.
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
    // JS-thread fallback: reanimated's measure() intermittently returns null
    // on Fabric (especially right after layout). measureInWindow is reliable
    // and uses the same coordinate space, so always publish from here too.
    // The store's identity check makes redundant publishes a no-op.
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
        <Animated.View style={[{ width: size, height: size }, pressFeedback.animatedStyle]}>
          <PressableFeedback
            accessibilityLabel="Scan QR code"
            accessibilityRole="button"
            animation={false}
            onPress={onPress}
            onPressIn={pressFeedback.onPressIn}
            onPressOut={pressFeedback.onPressOut}
            style={[styles.pressable, pressableStyle]}>
            <PressableFeedback.Ripple />
            <View style={[styles.container, containerStyle]} pointerEvents="none">
              <View style={[StyleSheet.absoluteFill, { backgroundColor: background }]} />
              <View
                style={[StyleSheet.absoluteFill, { backgroundColor: opacity(foreground, 0.65) }]}
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
                style={StyleSheet.absoluteFill}
              />
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { borderWidth: 1, borderColor: opacity(foreground, 0.4) },
                ]}
              />
            </View>
            <View
              style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}
              pointerEvents="none">
              <Icon name="stash:qr-code" size={38} color={background} />
            </View>
          </PressableFeedback>
        </Animated.View>
      </Animated.View>
    </Log>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  container: {
    overflow: 'hidden',
    position: 'absolute',
  },
});
