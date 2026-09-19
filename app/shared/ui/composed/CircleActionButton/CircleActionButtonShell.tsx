/**
 * Shared wrapper used by every CircleActionButton variant. Owns the outer
 * accessibility surface, the disabled-opacity dimming, and the optional
 * label-below-circle layout. Each variant provides its own `circle`
 * (SwiftUI glass / blurred View / flat Pressable) as children — the shell
 * stays identical across variants so the wallet home row stays
 * pixel-aligned regardless of which variant renders.
 */

import React, { useCallback } from 'react';
import { StyleSheet, type AccessibilityActionEvent } from 'react-native';
import { withAlpha } from '@/shared/lib/color';

import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import {
  LABELED_BUTTON_MIN_HEIGHT,
  LABEL_LINE_HEIGHT,
  LABEL_TOP_MARGIN,
  type CircleActionButtonProps,
} from './CircleActionButton.types';

interface CircleActionButtonShellProps extends CircleActionButtonProps {
  children: React.ReactNode;
}

export function CircleActionButtonShell({
  label,
  disabled = false,
  testID,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  onPressIn,
  onPressOut,
  children,
}: CircleActionButtonShellProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const interactive = !disabled && !!(onPress || onPressIn || onPressOut);
  const a11yLabel = accessibilityLabel ?? label;
  // The shell is the single accessible element, but the tap handler lives on
  // the variant's inner surface (an RN Pressable, or a gesture-handler Tap
  // that screen readers cannot reach). Route VoiceOver/TalkBack activation
  // here so every variant is operable without a touch at the glyph.
  const canActivate = interactive && !!onPress;
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'activate') onPress?.();
    },
    [onPress]
  );

  return (
    <View
      testID={testID}
      pointerEvents={interactive ? 'auto' : 'none'}
      accessible
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !interactive }}
      accessibilityActions={canActivate ? ACTIVATE_ACTIONS : undefined}
      onAccessibilityAction={canActivate ? handleAccessibilityAction : undefined}
      style={[
        styles.wrapper,
        label ? styles.labeledWrapper : null,
        { opacity: disabled ? 0.4 : 1 },
      ]}>
      {children}
      {label ? (
        <Text
          size={12}
          weight="medium"
          style={[styles.label, { color: withAlpha(foreground, 0.7) }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const ACTIVATE_ACTIONS = [{ name: 'activate' }] as const;

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labeledWrapper: {
    minHeight: LABELED_BUTTON_MIN_HEIGHT,
  },
  label: {
    lineHeight: LABEL_LINE_HEIGHT,
    textAlign: 'center',
    marginTop: LABEL_TOP_MARGIN,
  },
});
