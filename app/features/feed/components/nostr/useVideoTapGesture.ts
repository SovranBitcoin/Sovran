import React, { useCallback, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

import type { ImageOverlayLayout } from './image-overlay/types';

/**
 * Tap handling for an inline video block: measure the thumbnail and hand its
 * rect to the overlay, or fall back to the caller's tap / the OS browser.
 *
 * The container ref lives in here because the gesture's `onEnd` closes over it
 * and is handed to `Gesture.Tap()` during render — which React Compiler reads
 * as a render-time ref access, and a note body is on the feed's hot path.
 */
export function useVideoTapGesture({
  isAndroid,
  onBeforeOpen,
  onTap,
  openInBrowser,
  openOverlay,
  overlayLayout,
}: {
  isAndroid: boolean;
  onBeforeOpen?: () => void;
  onTap?: () => void;
  openInBrowser: () => void | Promise<void>;
  openOverlay?: (layout: ImageOverlayLayout) => void;
  overlayLayout?: Omit<ImageOverlayLayout, 'pageX' | 'pageY' | 'width' | 'height'>;
}) {
  const containerRef = useRef<React.ComponentRef<typeof View>>(null);

  const handleTap = useCallback(() => {
    if (openOverlay && overlayLayout && containerRef.current) {
      onBeforeOpen?.();
      containerRef.current.measureInWindow(
        (pageX: number, pageY: number, width: number, height: number) => {
          openOverlay({ ...overlayLayout, pageX, pageY, width, height });
        }
      );
    } else if (isAndroid) {
      void (onTap ?? openInBrowser)();
    } else if (onTap) {
      onTap();
    }
  }, [openOverlay, overlayLayout, onBeforeOpen, onTap, isAndroid, openInBrowser]);

  const tapGesture = useMemo(() => {
    if (!isAndroid && !handleTap) return undefined;
    return Gesture.Tap().onEnd(() => {
      'worklet';
      runOnJS(handleTap)();
    });
  }, [isAndroid, handleTap]);

  return { containerRef, tapGesture };
}
