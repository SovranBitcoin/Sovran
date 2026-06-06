import React from 'react';
import { StyleSheet } from 'react-native';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';
import { CIRCLE_SIZE, ICON_SIZE, type CircleActionButtonProps } from './CircleActionButton.types';
import { CircleActionButtonShell } from './CircleActionButtonShell';

export function CircleActionButtonBlur(props: CircleActionButtonProps): React.ReactElement {
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
          styles.blurPressable,
          pressed && interactive ? { opacity: 0.8 } : null,
        ]}
        hitSlop={6}>
        <View
          blur
          blurIntensity={60}
          blurTint="light"
          colorBlur="rgba(0,0,0,0.08)"
          style={[
            styles.blurCircle,
            {
              width: CIRCLE_SIZE,
              height: CIRCLE_SIZE,
              borderRadius: CIRCLE_SIZE / 2,
            },
          ]}>
          <Icon name={icon} size={ICON_SIZE} color={iconColor} />
        </View>
      </Pressable>
    </CircleActionButtonShell>
  );
}

const styles = StyleSheet.create({
  blurPressable: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  blurCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
