import { useCallback, useMemo, type ComponentProps } from 'react';
import { type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { GlassView } from 'expo-glass-effect';

import { useLatestGetter } from '@/shared/hooks/useLatestRef';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { withAlpha } from '@/shared/lib/color';
import { View } from '@/shared/ui/primitives/View/View';

import type { KeypadKey } from './KeypadKey';

/**
 * A keypad key in Liquid Glass (iOS 26+): the same slot, name and behaviour as
 * `KeypadKey`, with the glass's own press lensing as the press feedback.
 *
 * Built like `CircleActionButton.liquid`: an `expo-glass-effect` `GlassView`
 * driven by a gesture-handler `Tap`, because interactive glass installs its own
 * UIKit recognizer and an RN `Pressable` intermittently loses the touch to it.
 * Unlike that button there is no single-flight guard: a keypad must take the
 * same key twice in quick succession.
 */
export function KeypadGlassKey({
  testID,
  accessibilityLabel,
  disabled,
  onPress,
  height,
  strong = false,
  children,
}: ComponentProps<typeof KeypadKey>) {
  const foreground = useThemeColor('foreground');
  // The keypad re-renders on every digit; reading the handler late keeps the
  // gesture itself stable, so a re-render never reconfigures a tap in flight.
  const latestPress = useLatestGetter(onPress);
  const tap = useMemo(
    () =>
      Gesture.Tap()
        .runOnJS(true)
        .enabled(!disabled)
        .onEnd((_event, success) => {
          if (success) latestPress()();
        }),
    [disabled, latestPress]
  );

  // The Tap lives outside RN's responder system and screen readers cannot
  // drive it, so the wrapper claims the touch from any pressable ancestor and
  // carries the key's name, role and state, routing `activate` to the handler.
  const claimResponder = useCallback(() => true, []);
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') latestPress()();
    },
    [latestPress]
  );
  const size = height === undefined ? FILL : { height };

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: disabled }}
      accessibilityActions={disabled ? undefined : ACTIVATE_ACTIONS}
      onAccessibilityAction={disabled ? undefined : handleAccessibilityAction}
      onStartShouldSetResponder={disabled ? undefined : claimResponder}
      className="flex-1">
      <GestureDetector gesture={tap}>
        <GlassView
          glassEffectStyle="regular"
          isInteractive={!disabled}
          tintColor={strong ? withAlpha(foreground, 0.12) : undefined}
          style={[KEY_STYLE, size]}>
          {children}
        </GlassView>
      </GestureDetector>
    </View>
  );
}

const ACTIVATE_ACTIONS = [{ name: 'activate' }] as const;

const FILL = { flex: 1 } as const;

/** `GlassView` is a native view and takes no Tailwind class. */
const KEY_STYLE = {
  alignItems: 'center',
  borderCurve: 'continuous',
  borderRadius: 20,
  gap: 2,
  justifyContent: 'center',
  overflow: 'hidden',
} as const;
