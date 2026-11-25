import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Platform, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInUp,
  Keyframe,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { registerToast } from '@/shared/lib/popup/popups/bridge';
import { OverlayWindow } from './Sheet';

type Hide = () => void;
type ToastRequest = {
  component: (props: { id: string; hide: Hide }) => ReactElement;
  duration?: number | 'persistent';
  onShow?: () => void;
  onHide?: () => void;
};
type Entry = ToastRequest & { id: string };

const DEFAULT_DURATION_MS = 4000;
const MAX_VISIBLE = 3;
/** How long the overlay outlives its last toast, so the exit animation can play. */
const EXIT_MS = 150;
const ENTERING = FadeInUp.springify()
  .withInitialValues({ opacity: 1, transform: [{ translateY: -100 }] })
  .mass(3);
const EXITING = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
  100: {
    opacity: 0.5,
    transform: [{ translateY: -100 }, { scale: 0.97 }],
    easing: Easing.bezier(0.4, 0, 1, 1),
  },
}).duration(EXIT_MS);

let sequence = 0;

/**
 * The app's toasts: stacked at the top of the screen above everything (route
 * modals and sheets included), newest in front, the last three kept. Each
 * hides after its duration (4 s unless `persistent`), on a swipe up, or when
 * its own component calls `hide()`. Every toast is drawn once — there is no
 * measuring copy for a screen reader to find twice.
 */
export function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toasts, setToasts] = useState<Entry[]>([]);
  const [lingering, setLingering] = useState(false);
  const live = useRef(new Map<string, { entry: Entry; timer?: ReturnType<typeof setTimeout> }>());
  const removeRef = useRef<(id: string) => void>(() => undefined);

  useEffect(() => {
    const remove = (id: string) => {
      const record = live.current.get(id);
      if (!record) return;
      clearTimeout(record.timer);
      live.current.delete(id);
      record.entry.onHide?.();
      setToasts((list) => list.filter((entry) => entry.id !== id));
      setLingering(true);
    };
    const show = (request: Record<string, unknown>): string => {
      sequence += 1;
      const entry = { ...(request as ToastRequest), id: `host-toast-${sequence}` };
      const duration = entry.duration ?? DEFAULT_DURATION_MS;
      const timer =
        duration === 'persistent' ? undefined : setTimeout(() => remove(entry.id), duration);
      live.current.set(entry.id, { entry, timer });
      for (const stale of [...live.current.keys()].slice(0, -MAX_VISIBLE)) remove(stale);
      setToasts((list) => [...list.filter((item) => live.current.has(item.id)), entry]);
      entry.onShow?.();
      return entry.id;
    };
    removeRef.current = remove;
    registerToast({ show });
    const records = live.current;
    return () => {
      registerToast(null);
      records.forEach(({ timer }) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (!lingering || toasts.length > 0) return;
    const timer = setTimeout(() => setLingering(false), EXIT_MS + 50);
    return () => clearTimeout(timer);
  }, [lingering, toasts.length]);

  if (toasts.length === 0 && !lingering) return null;
  return (
    <OverlayWindow modal={false} zIndex={2000}>
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          top: insets.top + (Platform.OS === 'ios' ? 0 : 12),
          left: insets.left + 12,
          right: insets.right + 12,
        }}>
        {toasts.map((entry, index) => (
          <ToastItem
            key={entry.id}
            entry={entry}
            front={index === toasts.length - 1}
            // A toast's own `hide()` hides that toast, wherever it sits in the stack.
            hide={() => removeRef.current(entry.id)}
          />
        ))}
      </View>
    </OverlayWindow>
  );
}

function ToastItem({ entry, front, hide }: { entry: Entry; front: boolean; hide: Hide }) {
  const offset = useSharedValue(0);
  const swipe = Gesture.Pan()
    .onUpdate((event) => {
      // Up follows the finger; down only gives a little.
      offset.set(
        event.translationY < 0 ? event.translationY : Math.min(40, event.translationY / 10)
      );
    })
    .onEnd((event) => {
      if (event.translationY < -50 || event.velocityY < -500) scheduleOnRN(hide);
      else offset.set(withSpring(0));
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: offset.get() }] }));
  return (
    <GestureDetector gesture={swipe}>
      <Animated.View
        entering={ENTERING}
        exiting={EXITING}
        // The front toast lays out the stack's height; older ones sit behind it.
        className={front ? undefined : 'absolute left-0 right-0 top-0'}
        style={style}>
        {entry.component({ id: entry.id, hide })}
      </Animated.View>
    </GestureDetector>
  );
}
