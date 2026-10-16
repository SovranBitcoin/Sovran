import { type ReactNode } from 'react';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { useControlChrome } from '@/shared/styles/appStyle';
import { Pressable } from '@/shared/ui/primitives/Pressable';

import { usePressProgress } from './usePressProgress';

/** What every keypad key takes, whatever material it is drawn in. */
interface KeypadKeyProps {
  testID: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
  /** Omit to take whatever height the column gives. */
  height?: number;
  /** A function key rather than a digit: tinted where the key is glass. */
  strong?: boolean;
  children: ReactNode;
}

/**
 * One key in the app's control chrome: the surface and edge the mint selector
 * pill wears where there is no Liquid Glass, so the keypad and the pill above
 * it read as one set of controls. Pressing dims and tightens the key on the UI
 * thread from the touch itself, so typing never waits on a render.
 */
export function KeypadKey({
  testID,
  accessibilityLabel,
  disabled,
  onPress,
  height,
  children,
}: KeypadKeyProps) {
  const chrome = useControlChrome();
  const { progress, touch } = usePressProgress(70);
  const pressed = useAnimatedStyle(() => ({
    opacity: 1 - progress.get() * 0.35,
    transform: [{ scale: 1 - progress.get() * 0.04 }],
  }));
  const size = height === undefined ? { flex: 1 } : { height };
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      activeOpacity={1}
      className="flex-1"
      onPress={onPress}>
      <Animated.View
        className="items-center justify-center gap-0.5 rounded-[20px]"
        style={[CONTINUOUS, size, chrome, pressed]}
        {...touch}>
        {children}
      </Animated.View>
    </Pressable>
  );
}

const CONTINUOUS = { borderCurve: 'continuous' } as const;
