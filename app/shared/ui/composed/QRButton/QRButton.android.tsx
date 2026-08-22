import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import Animated, { useAnimatedRef } from 'react-native-reanimated';

import Icon from 'assets/icons';
import { Log, initLog } from '@/shared/lib/logger';
import { registerQRButtonRemeasure, setQRButtonAnchor } from '@/shared/lib/qrButtonAnchor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useQRButtonPressFeedback } from './useQRButtonPressFeedback';
import { useQRButtonReveal } from './useQRButtonReveal';
import { QRButtonFace } from './QRButtonFace';
import { qrButtonGeometry } from './qrButtonGeometry';

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

  const { borderRadius, containerStyle, pressableStyle } = qrButtonGeometry(size, foreground);

  const animatedRef = useAnimatedRef<Animated.View>();
  const visibilityStyle = useQRButtonReveal();
  const pressFeedback = useQRButtonPressFeedback();

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
          <Pressable
            accessibilityLabel="Scan QR code"
            accessibilityRole="button"
            style={[styles.touchable, pressableStyle]}
            className="items-center justify-center"
            activeOpacity={1}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={onPress}
            onPressIn={pressFeedback.onPressIn}
            onPressOut={pressFeedback.onPressOut}>
            <SquircleView style={[styles.container, containerStyle]} pointerEvents="none">
              <QRButtonFace foreground={foreground} background={background} />
            </SquircleView>
            <View
              style={[StyleSheet.absoluteFill, { justifyContent: 'center', alignItems: 'center' }]}
              pointerEvents="none">
              <Icon name="stash:qr-code" size={38} color={background} />
            </View>
          </Pressable>
        </Animated.View>
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
