import { useEffect, useRef } from 'react';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { SELECTION_HAPTICS } from '@/shared/ui/primitives/Haptics';
import { View } from '@/shared/ui/primitives/View/View';

import type { SelectableCheckProps } from './types';

/** The fill and check settle fast: a selection is feedback, not a show. */
const SELECT_MS = 150;

/**
 * In-app accent selection mark — a filled circle with a check when selected.
 * The split-bill participant picker is the canonical surface; the goal is a
 * brand-feeling tap target rather than a native checkbox. The check is drawn
 * in `accent-foreground`, so it keeps its contrast on a light accent.
 *
 * Pure visual when `onChange` is omitted (the parent row owns the press,
 * which is the ContactRow pattern). When `onChange` is provided the mark
 * wraps itself in a `Pressable` so it can stand alone.
 */
export function SelectableCheckCircle({
  selected,
  onChange,
  disabled = false,
  size = 20,
  accessibilityLabel,
  accessibilityHint,
  testID,
  selectProgress,
  recycleKey,
}: SelectableCheckProps) {
  const accentForeground = useThemeColor('accent-foreground');
  const reducedMotion = useReducedMotion();
  const ownProgress = useSharedValue(selected ? 1 : 0);
  // A recycled list cell now showing another item snaps to that item's state;
  // only a change on the same item (a tap) animates.
  const shownKey = useRef(recycleKey);
  useEffect(() => {
    const target = selected ? 1 : 0;
    const recycled = shownKey.current !== recycleKey;
    shownKey.current = recycleKey;
    ownProgress.set(
      reducedMotion || recycled ? target : withTiming(target, { duration: SELECT_MS })
    );
  }, [selected, reducedMotion, ownProgress, recycleKey]);
  const progress = selectProgress ?? ownProgress;
  const fillStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ scale: 0.6 + progress.get() * 0.4 }],
  }));

  const visual = (
    <View
      className={`items-center justify-center rounded-full ${disabled ? 'opacity-50' : ''}`}
      style={{ width: size, height: size }}>
      {/* Ring, then the accent fill fading over it, then the check. */}
      <View className="border-foreground/25 absolute inset-0 rounded-full border-[1.5px]" />
      <Animated.View
        pointerEvents="none"
        className="bg-accent absolute inset-0 rounded-full"
        style={fillStyle}
      />
      <Animated.View pointerEvents="none" style={markStyle}>
        <Icon name="mdi:check" size={Math.round(size * 0.65)} color={accentForeground} />
      </Animated.View>
    </View>
  );

  // Visual-only: the parent row is the control and carries the checked state.
  if (!onChange) return visual;

  return (
    <Pressable
      testID={testID}
      haptics={SELECTION_HAPTICS}
      onPress={() => !disabled && onChange(!selected)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: selected, disabled }}
      hitSlop={8}>
      {visual}
    </Pressable>
  );
}
