import Animated, {
  Easing,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
import { Pressable } from './Pressable';
import { SELECTION_HAPTICS, type PressHaptics } from './Haptics';

const TIMING = { duration: 175, easing: Easing.bezier(0.25, 0.1, 0.25, 1) };
const SPRING = { damping: 120, stiffness: 1600, mass: 2 };
const TRACK = { width: 48, height: 24 };
const THUMB = { width: 28, height: 20, inset: 2 };

type SwitchProps = {
  isSelected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  isDisabled?: boolean;
  /** Default: a selection tick on press-in. */
  haptics?: PressHaptics;
  testID?: string;
  accessibilityLabel?: string;
  'aria-label'?: string;
};

/**
 * The app's on/off switch: a 48×24 track whose 28×20 thumb springs across.
 *
 * The off track is the style's stroke step, derived from the canvas so it
 * shows on every wallpaper (the theme's `default` colour sits within a couple
 * of percent of the surface it is drawn on); on is the success green, the one
 * colour people already read as "on".
 */
export function Switch({
  isSelected = false,
  onSelectedChange,
  isDisabled = false,
  haptics = SELECTION_HAPTICS,
  testID,
  accessibilityLabel,
  'aria-label': ariaLabel,
}: SwitchProps) {
  const { track } = useStylePaint();
  const [on] = useThemeColor(['success'] as const);
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(isSelected ? on : track, TIMING),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    left: withSpring(isSelected ? TRACK.width - THUMB.width - THUMB.inset : THUMB.inset, SPRING),
  }));
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel ?? ariaLabel}
      accessibilityState={{ checked: isSelected, disabled: isDisabled }}
      disabled={isDisabled}
      activeOpacity={1}
      hitSlop={{ top: 10, bottom: 10 }}
      haptics={haptics}
      onPress={() => onSelectedChange?.(!isSelected)}
      style={{ opacity: isDisabled ? 0.5 : 1 }}>
      <Animated.View
        style={[
          { ...TRACK, borderRadius: 999, justifyContent: 'center', overflow: 'hidden' },
          trackStyle,
        ]}>
        <Animated.View
          className="shadow-field"
          style={[
            {
              position: 'absolute',
              width: THUMB.width,
              height: THUMB.height,
              borderRadius: 999,
              backgroundColor: 'white',
            },
            thumbStyle,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
