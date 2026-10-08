import { createContext, useContext, useRef, type ReactNode } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { INVARIANT_WHITE } from '@/shared/lib/brandColors';
import { withAlpha } from '@/shared/lib/color';

/**
 * Whether taps are drawn. Supplied by `TouchIndicatorProvider` from the
 * setting, so this file reads no store and any surface can mount a layer
 * unconditionally.
 */
export const TouchIndicatorEnabled = createContext(false);

const DOT = 44;
// Built when a touch needs it, not at import: this module is pulled in by the
// root layout, and some suites stub Reanimated without its easing helpers.
const easeOut = () => Easing.bezier(0.23, 1, 0.32, 1);
const FILL = { flex: 1 } as const;
const MARK = {
  position: 'absolute' as const,
  left: 0,
  top: 0,
  width: DOT,
  height: DOT,
  borderRadius: DOT / 2,
  zIndex: 99999,
};
const DOT_STYLE = {
  ...MARK,
  backgroundColor: withAlpha(INVARIANT_WHITE, 0.28),
  borderWidth: 1.5,
  borderColor: withAlpha(INVARIANT_WHITE, 0.85),
};
const RIPPLE_STYLE = {
  ...MARK,
  borderWidth: 1.5,
  borderColor: withAlpha(INVARIANT_WHITE, 0.7),
};

/**
 * The touch most recently drawn by any layer. Layers nest (a screen's inside
 * the app's), and a touch bubbles through all of them, innermost first; the
 * first to see it draws it and the rest leave it alone.
 */
let lastDrawn = '';
const touchKey = (event: GestureResponderEvent) =>
  `${event.nativeEvent.identifier}:${event.nativeEvent.timestamp}`;

interface TouchIndicatorLayerProps {
  children: ReactNode;
  /** Fill the parent (a screen or the app). Off for content that sizes itself. */
  fill?: boolean;
}

/**
 * Draws where the finger is, for screen recordings: a soft disc under the
 * finger that follows a drag, and a ring that spreads from the point of
 * release. iOS has no "show touches" setting, and a recording made off the
 * device cannot add one afterwards.
 *
 * A layer draws in the same space its touches are reported in. A touch's page
 * coordinates are relative to the native container it lands in (a modal, a
 * sheet, an overlay window), not to the screen, so one layer over the whole
 * app would draw taps inside a sheet in the wrong place. Each container
 * mounts its own layer instead. It only listens as touches bubble past; it
 * never becomes the responder, so nothing underneath behaves differently.
 */
export function TouchIndicatorLayer({ children, fill = true }: TouchIndicatorLayerProps) {
  // Switched off, a layer is nothing at all: no wrapper view, no listeners
  // and no shared values, on every screen of every build.
  if (!useContext(TouchIndicatorEnabled)) return <>{children}</>;
  return <ActiveLayer fill={fill}>{children}</ActiveLayer>;
}

function ActiveLayer({ children, fill }: Required<TouchIndicatorLayerProps>) {
  const frame = useRef<View>(null);
  // Where the layer sits in the page space its touches report in.
  const origin = useRef({ x: 0, y: 0 });
  const owns = useRef(false);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const held = useSharedValue(0);
  const ripple = useSharedValue(1);

  const dot = useAnimatedStyle(() => ({
    opacity: held.get(),
    transform: [
      { translateX: x.get() - DOT / 2 },
      { translateY: y.get() - DOT / 2 },
      { scale: 0.8 + held.get() * 0.2 },
    ],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: (1 - ripple.get()) * 0.9,
    transform: [
      { translateX: x.get() - DOT / 2 },
      { translateY: y.get() - DOT / 2 },
      { scale: 1 + ripple.get() * 0.9 },
    ],
  }));

  const measure = () => {
    frame.current?.measure((_x, _y, _width, _height, pageX, pageY) => {
      origin.current = { x: pageX ?? 0, y: pageY ?? 0 };
    });
  };
  const place = (event: GestureResponderEvent) => {
    x.set(event.nativeEvent.pageX - origin.current.x);
    y.set(event.nativeEvent.pageY - origin.current.y);
  };
  const release = () => {
    if (!owns.current) return;
    owns.current = false;
    held.set(withTiming(0, { duration: 260, easing: easeOut() }));
    ripple.set(0);
    ripple.set(withTiming(1, { duration: 420, easing: easeOut() }));
  };

  return (
    <View
      ref={frame}
      style={fill ? FILL : undefined}
      onLayout={measure}
      onTouchStart={(event) => {
        const key = touchKey(event);
        if (lastDrawn === key) return;
        lastDrawn = key;
        owns.current = true;
        place(event);
        ripple.set(1);
        held.set(withTiming(1, { duration: 70, easing: easeOut() }));
      }}
      onTouchMove={(event) => {
        if (owns.current) place(event);
      }}
      onTouchEnd={release}
      onTouchCancel={release}>
      {children}
      <Animated.View pointerEvents="none" style={[RIPPLE_STYLE, ring]} />
      <Animated.View pointerEvents="none" style={[DOT_STYLE, dot]} />
    </View>
  );
}
