import { useCallback, useEffect } from 'react';
import type Animated from 'react-native-reanimated';
import type { AnimatedRef } from 'react-native-reanimated';

import { initLog } from '@/shared/lib/logger';
import { registerQRButtonRemeasure, setQRButtonAnchor } from '@/shared/lib/qrButtonAnchor';

export interface QRButtonProps {
  onPress: () => void;
  accentColor?: string;
  color?: string;
  size?: number;
}

export const DEFAULT_SIZE = 64;

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
