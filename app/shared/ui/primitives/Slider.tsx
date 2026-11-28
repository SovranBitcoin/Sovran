import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { EnhancedHaptics } from './Haptics';

const THUMB_WIDTH = 28;

type SliderProps = {
  value: number;
  minValue: number;
  maxValue: number;
  step?: number;
  isDisabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  /** Every stepped value while dragging. */
  onChange?: (value: number) => void;
  /** The stepped value where the drag or tap ended. */
  onChangeEnd?: (value: number) => void;
};

function snap(raw: number, min: number, max: number, step: number): number {
  'worklet';
  const clamped = Math.min(max, Math.max(min, raw));
  return Math.min(max, min + Math.round((clamped - min) / step) * step);
}

/**
 * A horizontal slider: a 20pt track, an accent fill up to a 28×20 thumb whose
 * knob shrinks while held. Drag or tap anywhere on the track; values snap to
 * `step`. Screen readers adjust it one step at a time.
 */
export function Slider({
  value,
  minValue,
  maxValue,
  step = 1,
  isDisabled = false,
  testID,
  accessibilityLabel,
  onChange,
  onChangeEnd,
}: SliderProps) {
  const [width, setWidth] = useState(0);
  const range = maxValue - minValue || 1;
  const percent = useSharedValue((value - minValue) / range);
  const dragging = useSharedValue(false);
  const last = useSharedValue(value);
  const dragStart = useSharedValue(value);
  // Follow the controlled value, except under the finger.
  useEffect(() => {
    if (!dragging.get()) percent.set((value - minValue) / range);
    last.set(value);
  }, [dragging, last, minValue, percent, range, value]);

  const emit = (next: number, end: boolean) => {
    if (end) onChangeEnd?.(next);
    else {
      // `moveTo` emits a move only when the snapped value changes, so this is
      // one selection tick per step crossed, not one per frame.
      void EnhancedHaptics.navigateHaptic();
      onChange?.(next);
    }
  };
  const track = Math.max(0, width - THUMB_WIDTH);
  const moveTo = (x: number, end: boolean) => {
    'worklet';
    if (track <= 0) return;
    const next = snap(minValue + ((x - THUMB_WIDTH / 2) / track) * range, minValue, maxValue, step);
    percent.set((next - minValue) / range);
    if (end || next !== last.get()) {
      last.set(next);
      scheduleOnRN(emit, next, end);
    }
  };
  const revertDrag = () => {
    'worklet';
    const original = dragStart.get();
    percent.set((original - minValue) / range);
    if (last.get() !== original) {
      last.set(original);
      scheduleOnRN(emit, original, false);
    }
  };
  // Require horizontal intent before taking over from a parent vertical scroll
  // view, and commit `onChangeEnd` only when the drag or tap succeeds.
  const pan = Gesture.Pan()
    .enabled(!isDisabled)
    .activeOffsetX([-6, 6])
    .failOffsetY([-10, 10])
    .onStart((event) => {
      dragging.set(true);
      dragStart.set(last.get());
      moveTo(event.x, false);
    })
    .onUpdate((event) => moveTo(event.x, false))
    .onEnd((event, success) => {
      if (success) moveTo(event.x, true);
      else revertDrag();
    })
    .onFinalize((_event, success) => {
      if (!success && dragging.get()) revertDrag();
      dragging.set(false);
    });
  const tap = Gesture.Tap()
    .enabled(!isDisabled)
    .maxDistance(6)
    .onEnd((event, success) => {
      if (!success) return;
      moveTo(event.x, false);
      moveTo(event.x, true);
    });
  const gesture = Gesture.Exclusive(pan, tap);

  const adjust = (direction: 1 | -1) => {
    if (isDisabled) return;
    const next = snap(value + direction * step, minValue, maxValue, step);
    onChange?.(next);
    onChangeEnd?.(next);
  };

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID={testID}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ min: minValue, max: maxValue, now: value }}
        accessibilityState={{ disabled: isDisabled }}
        accessibilityActions={isDisabled ? [] : [{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) =>
          adjust(event.nativeEvent.actionName === 'increment' ? 1 : -1)
        }
        hitSlop={{ top: 12, bottom: 12 }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        className={isDisabled ? 'opacity-disabled w-full' : 'w-full'}>
        <View className="bg-default h-5 w-full justify-center rounded-xl">
          <SliderParts percent={percent} dragging={dragging} track={track} />
        </View>
      </View>
    </GestureDetector>
  );
}

function SliderParts({
  percent,
  dragging,
  track,
}: {
  percent: SharedValue<number>;
  dragging: SharedValue<boolean>;
  track: number;
}) {
  const fill = useAnimatedStyle(() => ({ width: percent.get() * track + THUMB_WIDTH }));
  const thumb = useAnimatedStyle(() => ({ left: percent.get() * track }));
  const knob = useAnimatedStyle(() => ({
    transform: [
      { scale: withSpring(dragging.get() ? 0.9 : 1, { damping: 15, stiffness: 200, mass: 0.5 }) },
    ],
  }));
  return (
    <>
      <Animated.View className="bg-accent absolute bottom-0 top-0 rounded-xl" style={fill} />
      <Animated.View
        className="bg-accent absolute h-5 rounded-xl p-0.5"
        style={[{ width: THUMB_WIDTH }, thumb]}>
        <Animated.View
          className="bg-accent-foreground shadow-field flex-1 rounded-xl"
          style={knob}
        />
      </Animated.View>
    </>
  );
}
