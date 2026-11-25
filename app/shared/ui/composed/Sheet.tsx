import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewProps,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { scheduleOnRN } from 'react-native-worklets';

import { cn } from '@/shared/lib/classNames';
import { injectParts } from '@/shared/lib/injectParts';
import { Pressable } from '@/shared/ui/primitives/Pressable';

const OPEN_SPRING = { damping: 500, stiffness: 1000, mass: 3, overshootClamping: true };
const CLOSE_TIMING = { duration: 250, easing: Easing.out(Easing.exp) };
/** Dragged further than this share of its height, or flung, the sheet dismisses. */
const DISMISS_SHARE = 0.25;
const DISMISS_VELOCITY = 800;

/** Handed to each `SheetScrollView` by its sheet (`injectParts`). */
type SheetScroll = { offset: SharedValue<number>; gesture: ReturnType<typeof Gesture.Native> };

/**
 * Where an overlay draws: above everything, route modals included. iOS needs a
 * FullWindowOverlay for that (and a gesture root inside it); on Android a
 * host mounted after the navigator sits on top, ordered by `zIndex`/`elevation`
 * so toasts always stay above sheet scrims. Non-modal overlays (toasts) must
 * pass `modal={false}` so VoiceOver can still reach the screen beneath.
 */
export function OverlayWindow({
  children,
  modal = true,
  zIndex,
}: {
  children: ReactNode;
  modal?: boolean;
  zIndex?: number;
}) {
  const body = (
    <GestureHandlerRootView
      style={[StyleSheet.absoluteFill, zIndex != null ? { zIndex, elevation: zIndex } : undefined]}
      pointerEvents="box-none">
      {children}
    </GestureHandlerRootView>
  );
  return Platform.OS === 'ios' ? (
    <FullWindowOverlay unstable_accessibilityContainerViewIsModal={modal}>{body}</FullWindowOverlay>
  ) : (
    body
  );
}

type SheetProps = {
  /** The target state. The sheet mounts with its content and animates up once laid out. */
  open: boolean;
  /** A swipe down or a scrim tap asked to close; the owner flips `open`. */
  onDismissRequest: () => void;
  /** The enter animation landed. */
  onPresented?: () => void;
  /** The exit animation landed; the owner may unmount. */
  onClosed?: () => void;
  /** `false` ignores the scrim and the swipe (the sheet can still be closed by its owner). */
  dismissable?: boolean;
  /** Fixed height (a fraction of the window, e.g. '60%'); otherwise it fits its content. */
  height?: `${number}%`;
  /** A floating card inset from the edges, instead of a bottom-edge sheet. */
  detached?: boolean;
  /** Pinned over the bottom of the sheet; rides above the keyboard with it. */
  footer?: ReactNode;
  scrimColor: string;
  scrimTestID?: string;
  scrimLabel?: string;
  backgroundClassName?: string;
  /** Animated colour for the sheet surface and its handle (live status sheets). */
  surfaceStyle?: ComponentProps<typeof Animated.View>['style'];
  /** `false` keeps the handle's space but draws no grab bar. */
  handle?: boolean;
  /** Merged over the content padding (`p-5`, safe area + 12pt at the bottom). */
  contentClassName?: string;
  children: ReactNode;
};

/**
 * A bottom sheet: scrim, handle and content mounted immediately. It slides up
 * once measured, follows the keyboard, and dismisses on a drag or fling down
 * (inside a `SheetScrollView`, only once the list is at its top).
 */
export function Sheet({
  open,
  onDismissRequest,
  onPresented,
  onClosed,
  dismissable = true,
  height,
  detached = false,
  footer,
  scrimColor,
  scrimTestID,
  scrimLabel = 'Dismiss',
  backgroundClassName = 'bg-overlay',
  surfaceStyle,
  handle = true,
  contentClassName,
  children,
}: SheetProps) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keyboard = useReanimatedKeyboardAnimation();
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const measured = useSharedValue(0);
  const [laidOut, setLaidOut] = useState(false);
  const scroll: SheetScroll = {
    offset: useSharedValue(0),
    gesture: Gesture.Native(),
  };

  // Read when the animation lands; restarting on their identity would replay it.
  const callbacks = useRef({ onPresented, onClosed });
  useEffect(() => {
    callbacks.current = { onPresented, onClosed };
  });
  useEffect(() => {
    const presented = () => callbacks.current.onPresented?.();
    const closed = () => callbacks.current.onClosed?.();
    if (open && laidOut) {
      drag.set(0);
      progress.set(
        withSpring(1, OPEN_SPRING, (done) => {
          if (done) scheduleOnRN(presented);
        })
      );
    } else if (!open) {
      progress.set(
        withTiming(0, CLOSE_TIMING, (done) => {
          if (done) scheduleOnRN(closed);
        })
      );
    }
  }, [open, laidOut, progress, drag]);

  const pan = Gesture.Pan()
    .enabled(dismissable && open)
    .activeOffsetY([-8, 8])
    .simultaneousWithExternalGesture(scroll.gesture)
    .onUpdate((event) => {
      if (scroll.offset.get() > 0) return;
      drag.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      const far = drag.get() > measured.get() * DISMISS_SHARE;
      if (drag.get() > 0 && (far || event.velocityY > DISMISS_VELOCITY)) {
        scheduleOnRN(onDismissRequest);
      } else {
        drag.set(withSpring(0, OPEN_SPRING));
      }
    });

  const bottomGap = detached ? insets.bottom : 0;
  const panelStyle = useAnimatedStyle(() => {
    const travel = measured.get() + bottomGap;
    const hidden = measured.get() === 0 ? window.height : (1 - progress.get()) * travel;
    return { transform: [{ translateY: hidden + drag.get() + keyboard.height.get() }] };
  });
  const scrimStyle = useAnimatedStyle(() => {
    const share = measured.get() > 0 ? 1 - drag.get() / measured.get() : 1;
    return { opacity: Math.max(0, Math.min(progress.get(), share)) };
  });

  const fixedHeight = height ? (window.height * parseFloat(height)) / 100 : undefined;
  return (
    <OverlayWindow modal zIndex={1000}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessible={false}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: scrimColor }, scrimStyle]}>
          <Pressable
            testID={scrimTestID}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel={scrimLabel}
            accessibilityState={{ disabled: !dismissable }}
            style={StyleSheet.absoluteFill}
            onPress={dismissable ? onDismissRequest : undefined}
          />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            accessible={false}
            onLayout={(event) => {
              measured.set(event.nativeEvent.layout.height);
              setLaidOut(true);
            }}
            className={cn(
              'absolute overflow-hidden',
              detached ? 'left-4 right-4 rounded-[32px]' : 'rounded-t-4xl left-0 right-0',
              backgroundClassName
            )}
            style={[
              { bottom: bottomGap, borderCurve: 'continuous' },
              fixedHeight != null
                ? { height: fixedHeight }
                : { maxHeight: window.height - insets.top },
              surfaceStyle,
              panelStyle,
            ]}>
            <View className="items-center p-2.5">
              <View className={cn('h-1 w-9 rounded-full', handle && 'bg-separator')} />
            </View>
            <View
              className={cn(
                'pb-safe-offset-3 p-5',
                fixedHeight != null && 'flex-1',
                contentClassName
              )}>
              {injectParts(children, [SheetScrollView], { sheet: scroll })}
            </View>
            {footer ? <View className="absolute bottom-0 left-0 right-0">{footer}</View> : null}
          </Animated.View>
        </GestureDetector>
      </View>
    </OverlayWindow>
  );
}

/**
 * A ScrollView whose sheet only takes a downward drag once it is at its top.
 */
export function SheetScrollView({ sheet, ...props }: ScrollViewProps & { sheet?: SheetScroll }) {
  const fallback = useSharedValue(0);
  const offset = sheet?.offset ?? fallback;
  const onScroll = useAnimatedScrollHandler((event) => {
    offset.set(event.contentOffset.y);
  });
  const list = <Animated.ScrollView {...props} onScroll={onScroll} scrollEventThrottle={16} />;
  return sheet ? <GestureDetector gesture={sheet.gesture}>{list}</GestureDetector> : list;
}
