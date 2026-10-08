import { useCallback, useEffect } from 'react';
import type Animated from 'react-native-reanimated';
import { useAnimatedRef } from 'react-native-reanimated';
import type { AnimatedRef } from 'react-native-reanimated';

import { initLog } from '@/shared/lib/logger';
import { registerQRButtonRemeasure, setQRButtonAnchor } from '@/shared/lib/qrButtonAnchor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { qrButtonGeometry } from './qrButtonGeometry';
import { useQRButtonPressFeedback } from './useQRButtonPressFeedback';
import { useQRButtonReveal } from './useQRButtonReveal';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
  /** e2e selector for the press surface. Defaults to `qr-scan-button`. */
  testID?: string;
}

export const DEFAULT_SIZE = 64;

/**
 * Everything the two platform shells must agree on: theme colors, geometry,
 * the anchor ref, and the reveal/press-feedback animations. Only the press
 * surface and the anchor-measurement strategy stay platform-specific.
 *
 * Colours invert with the theme: on dark themes the base is the foreground
 * (white) with a soft white gradient and a dark icon; on light themes the base
 * is the foreground (black) with a soft black gradient and a light icon.
 */
export function useQRButtonChrome(size: number) {
  const paint = useStylePaint();
  // The scan control is the home's one filled control, so it wears the
  // style's primary paint: the foreground in a monochrome style, the accent in
  // an accent style. The glass style keeps its original foreground tile.
  const glassStyle = paint.style.surface === 'glass';
  const fill = paint.primary.container.backgroundColor;
  const foreground = glassStyle || typeof fill !== 'string' ? paint.text.primary : fill;
  const background = glassStyle ? paint.canvas : paint.primary.content;
  // The glass style keeps the original glossy tile and its glow. Every other
  // style draws a plain foreground fill in the style's own control radius.
  const glass = glassStyle;
  const { borderRadius, containerStyle, pressableStyle } = qrButtonGeometry(
    size,
    glass ? size * 0.18 : paint.style.radius.control,
    glass ? foreground : null
  );
  const animatedRef = useAnimatedRef<Animated.View>();
  const visibilityStyle = useQRButtonReveal();
  const pressFeedback = useQRButtonPressFeedback();
  return {
    foreground,
    background,
    glass,
    borderRadius,
    containerStyle,
    pressableStyle,
    animatedRef,
    visibilityStyle,
    pressFeedback,
  };
}

/**
 * JS-thread anchor publish. measureInWindow is reliable on both platforms and
 * uses the window coordinate space the splash morph consumes; the anchor
 * store's identity check makes redundant publishes a no-op.
 */
export function usePublishAnchorInWindow(
  animatedRef: AnimatedRef<Animated.View>,
  borderRadius: number
): () => void {
  return useCallback(() => {
    const node = animatedRef.current as unknown as {
      measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void;
    } | null;
    node?.measureInWindow?.((x, y, w, h) => {
      if (!w || !h) return;
      setQRButtonAnchor({ x, y, width: w, height: h, borderRadius });
      initLog('QRButtonAnchor', `measureInWindow(JS) — x=${x} y=${y} width=${w} height=${h}`);
    });
  }, [animatedRef, borderRadius]);
}

/** Re-publish on demand for the lifetime of the button; clear the anchor on unmount. */
export function useQRButtonAnchorRegistration(publishAnchor: () => void): void {
  useEffect(() => {
    const unregister = registerQRButtonRemeasure(publishAnchor);
    return () => {
      unregister();
      setQRButtonAnchor(null);
    };
  }, [publishAnchor]);
}
