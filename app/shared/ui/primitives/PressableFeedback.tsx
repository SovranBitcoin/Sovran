import { forwardRef, type ReactNode } from 'react';
import {
  StyleSheet,
  View as RNView,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useColorScheme } from '@/shared/hooks/useColorScheme';
import { injectParts } from '@/shared/lib/injectParts';
import { Pressable } from './Pressable';

type PressState = {
  pressed: SharedValue<boolean>;
  width: SharedValue<number>;
  height: SharedValue<number>;
  touchX: SharedValue<number>;
  touchY: SharedValue<number>;
  ripple: SharedValue<number>;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Shrinks a 300pt-wide surface by 1.5%; wider surfaces shrink proportionally less. */
function useScaleStyle({ pressed, width }: PressState, enabled: boolean) {
  return useAnimatedStyle(() => {
    if (!enabled) return { transform: [{ scale: 1 }] };
    const coefficient = width.get() > 0 ? 300 / width.get() : 1;
    const target = pressed.get() ? 1 - 0.015 * coefficient : 1;
    return {
      transform: [
        { scale: withTiming(target, { duration: 300, easing: Easing.out(Easing.ease) }) },
      ],
    };
  });
}

/** The press tint: zinc-300 over dark themes, zinc-700 over light ones. */
function useTint(): string {
  // eslint-disable-next-line no-restricted-syntax -- the press tint is theme-invariant per scheme
  return useColorScheme() === 'dark' ? '#d4d4d8' : '#3f3f46';
}

type PressableFeedbackProps = Omit<React.ComponentProps<typeof Pressable>, 'children'> & {
  children?: ReactNode;
  isDisabled?: boolean;
  /** `false` keeps the root still; a `<PressableFeedback.Scale>` child scales instead. */
  animation?: false;
  className?: string;
};

/**
 * A pressable surface with composable feedback: `.Scale` shrinks its
 * children while held, `.Ripple` spreads a tint from the touch point, and
 * `.Highlight` fades a flat tint in. Without `animation={false}` the whole
 * root scales.
 */
const PressableFeedbackRoot = forwardRef<RNView, PressableFeedbackProps>(function PressableFeedback(
  { isDisabled, disabled, animation, style, onLayout, onPressIn, onPressOut, children, ...rest },
  ref
) {
  const state: PressState = {
    pressed: useSharedValue(false),
    width: useSharedValue(0),
    height: useSharedValue(0),
    touchX: useSharedValue(0),
    touchY: useSharedValue(0),
    ripple: useSharedValue(0),
  };
  const rootScale = useScaleStyle(state, animation !== false);
  return (
    <AnimatedPressable
      ref={ref}
      activeOpacity={1}
      style={[styles.root, rootScale, style as StyleProp<ViewStyle>]}
      disabled={isDisabled ?? disabled}
      onLayout={(event: LayoutChangeEvent) => {
        state.width.set(event.nativeEvent.layout.width);
        state.height.set(event.nativeEvent.layout.height);
        onLayout?.(event);
      }}
      onPressIn={(event: GestureResponderEvent) => {
        state.pressed.set(true);
        onPressIn?.(event);
      }}
      onPressOut={(event: GestureResponderEvent) => {
        state.pressed.set(false);
        onPressOut?.(event);
      }}
      {...rest}>
      {injectParts(
        children,
        [PressableFeedbackScale, PressableFeedbackHighlight, PressableFeedbackRipple],
        { press: state }
      )}
    </AnimatedPressable>
  );
});

/** Handed to each part by the root (`injectParts`); parts only render inside one. */
type PartProps = { press?: PressState };

function PressableFeedbackScale({
  children,
  style,
  press,
}: PartProps & { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const scale = useScaleStyle(press as PressState, true);
  return <Animated.View style={[scale, style]}>{children}</Animated.View>;
}

function PressableFeedbackHighlight({ press }: PartProps) {
  const { pressed } = press as PressState;
  const backgroundColor = useTint();
  const fade = useAnimatedStyle(() => ({
    backgroundColor,
    opacity: withTiming(pressed.get() ? 0.1 : 0, { duration: 200 }),
  }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, fade]} />;
}

/** Ripple progress: 0 → 1 spreads in while held, 1 → 2 fades out on release. */
function PressableFeedbackRipple({ press }: PartProps) {
  const state = press as PressState;
  const backgroundColor = useTint();
  const duration = () => {
    const diagonal = Math.hypot(state.width.get(), state.height.get());
    return Math.min(Math.max(1000 * (diagonal > 0 ? diagonal / 450 : 1), 750), 2000);
  };
  const layer = useAnimatedStyle(() => {
    const radius = Math.hypot(state.width.get(), state.height.get()) * 1.25;
    const progress = state.ripple.get();
    return {
      backgroundColor,
      width: radius * 2,
      height: radius * 2,
      borderRadius: radius,
      opacity: interpolate(progress, [0, 1, 2], [0, 0.1, 0]),
      transform: [
        { translateX: state.touchX.get() - radius },
        { translateY: state.touchY.get() - radius },
        { scale: interpolate(progress, [0, 1, 2], [0, 1, 1]) },
      ],
    };
  });
  return (
    <RNView
      style={StyleSheet.absoluteFill}
      onTouchStart={(event) => {
        state.touchX.set(event.nativeEvent.locationX);
        state.touchY.set(event.nativeEvent.locationY);
        state.ripple.set(0);
        state.ripple.set(withTiming(1, { duration: duration() }));
      }}
      onTouchEnd={() => state.ripple.set(withTiming(2, { duration: duration() }))}
      onTouchCancel={() => state.ripple.set(withTiming(2, { duration: duration() }))}>
      <Animated.View pointerEvents="none" style={[styles.ripple, layer]} />
    </RNView>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden', borderCurve: 'continuous' },
  ripple: { position: 'absolute', top: 0, left: 0 },
});

export const PressableFeedback = Object.assign(PressableFeedbackRoot, {
  Scale: PressableFeedbackScale,
  Highlight: PressableFeedbackHighlight,
  Ripple: PressableFeedbackRipple,
});
