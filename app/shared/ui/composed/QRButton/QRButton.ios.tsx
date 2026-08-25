import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { PressableFeedback } from 'heroui-native';
import Animated, { measure, runOnJS, runOnUI, useAnimatedRef } from 'react-native-reanimated';

import Icon from 'assets/icons';
import { Log, initLog } from '@/shared/lib/logger';
import { setQRButtonAnchor } from '@/shared/lib/qrButtonAnchor';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import {
  DEFAULT_SIZE,
  usePublishAnchorInWindow,
  useQRButtonAnchorRegistration,
} from './QRButton.shared';
import type { QRButtonProps } from './QRButton.shared';
import { useQRButtonPressFeedback } from './useQRButtonPressFeedback';
import { useQRButtonReveal } from './useQRButtonReveal';
import { QRButtonFace } from './QRButtonFace';
import { qrButtonGeometry } from './qrButtonGeometry';

export function QRButton(props: QRButtonProps): React.ReactElement {
  // Inverts with the theme: on dark themes the base is the foreground (white)
  // with a soft white gradient and a dark icon; on light themes the base is
  // the foreground (black) with a soft black gradient and a light icon.
  const [foreground, background] = useThemeColor(['foreground', 'background'] as const);

  const { onPress, size = DEFAULT_SIZE } = props;

  const { borderRadius, containerStyle, pressableStyle } = qrButtonGeometry(size, foreground);

  const animatedRef = useAnimatedRef<Animated.View>();
  const visibilityStyle = useQRButtonReveal();
  const pressFeedback = useQRButtonPressFeedback();

  // JS-thread fallback: reanimated's measure() intermittently returns null
  // on Fabric (especially right after layout), so always publish from the
  // measureInWindow path too.
  const publishInWindow = usePublishAnchorInWindow(animatedRef, borderRadius);

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
    publishInWindow();
  }, [animatedRef, borderRadius, publishInWindow]);

  useQRButtonAnchorRegistration(publishAnchor);

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
              <QRButtonFace foreground={foreground} background={background} />
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
