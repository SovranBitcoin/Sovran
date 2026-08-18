import React from 'react';
import { StyleSheet } from 'react-native';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { CIRCLE_SIZE, ICON_SIZE, type CircleActionButtonProps } from './CircleActionButton.types';
import { CircleActionButtonShell } from './CircleActionButtonShell';

export function CircleActionButtonFlat(props: CircleActionButtonProps): React.ReactElement {
  const [foreground, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
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
          styles.circle,
          {
            backgroundColor: surfaceSecondary,
            borderColor: withAlpha(muted, 0.3),
          },
          pressed && interactive ? { opacity: 0.8 } : null,
        ]}
        hitSlop={6}>
        <Icon name={icon} size={ICON_SIZE} color={iconColor} />
      </Pressable>
    </CircleActionButtonShell>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1,
  },
});
