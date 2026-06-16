import React from 'react';
import { StyleSheet } from 'react-native';

import { GlassView } from 'expo-glass-effect';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { CIRCLE_SIZE, ICON_SIZE, type CircleActionButtonProps } from './CircleActionButton.types';
import { CircleActionButtonShell } from './CircleActionButtonShell';

// Liquid Glass via expo-glass-effect's GlassView (a UIVisualEffectView-backed
// RN view) rather than an @expo/ui SwiftUI `Host`. Host views (UIHostingController)
// don't follow an RN ScrollView's content transform and visually pin to the top
// while scrolling (expo/expo#46278); GlassView scrolls like any RN view.
export function CircleActionButtonLiquid(props: CircleActionButtonProps): React.ReactElement {
  const [foreground] = useThemeColor(['foreground'] as const);
  const { icon, onPress, onPressIn, onPressOut, disabled = false, color } = props;
  const iconColor = color ?? foreground;
  const interactive = !disabled && !!(onPress || onPressIn || onPressOut);

  return (
    <CircleActionButtonShell {...props}>
      <Pressable
        onPress={interactive ? onPress : undefined}
        onPressIn={interactive ? onPressIn : undefined}
        onPressOut={interactive ? onPressOut : undefined}
        disabled={!interactive}
        style={({ pressed }) => [
          styles.pressable,
          pressed && interactive ? { opacity: 0.85 } : null,
        ]}
        hitSlop={6}>
        <GlassView
          glassEffectStyle="regular"
          isInteractive={interactive}
          style={[
            styles.circle,
            { width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2 },
          ]}>
          <Icon name={icon} size={ICON_SIZE} color={iconColor} />
        </GlassView>
      </Pressable>
    </CircleActionButtonShell>
  );
}

const styles = StyleSheet.create({
  pressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
