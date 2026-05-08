import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { Text } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';

interface CircleActionButtonProps {
  icon: string;
  systemIcon?: string;
  label?: string;
  onPress?: () => void;
  disabled?: boolean;
  color?: string;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const CIRCLE_SIZE = 52;
const ICON_SIZE = 22;
const LABEL_TOP_MARGIN = 6;
const LABEL_LINE_HEIGHT = 18;
const LABELED_BUTTON_MIN_HEIGHT = CIRCLE_SIZE + LABEL_TOP_MARGIN + LABEL_LINE_HEIGHT;

export function CircleActionButton({
  icon,
  label,
  onPress,
  disabled = false,
  color,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: CircleActionButtonProps): React.ReactElement {
  const [foreground, surfaceSecondary, muted] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
  const iconColor = color ?? foreground;
  const interactive = !disabled && !!onPress;

  return (
    <Log name="CircleActionButton">
      <View
        testID={testID}
        pointerEvents={interactive ? 'auto' : 'none'}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled: !interactive }}
        style={[
          styles.wrapper,
          label ? styles.labeledWrapper : null,
          { opacity: disabled ? 0.4 : 1 },
        ]}>
        <Pressable
          onPress={interactive ? onPress : undefined}
          disabled={!interactive}
          style={({ pressed }) => [
            styles.circle,
            {
              backgroundColor: surfaceSecondary,
              borderColor: opacity(muted, 0.3),
            },
            pressed && interactive ? { opacity: 0.8 } : null,
          ]}
          hitSlop={6}>
          <Icon name={icon} size={ICON_SIZE} color={iconColor} />
        </Pressable>
        {label ? (
          <Text
            size={12}
            weight="medium"
            style={[styles.label, { color: opacity(foreground, 0.7) }]}>
            {label}
          </Text>
        ) : null}
      </View>
    </Log>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  labeledWrapper: {
    minHeight: LABELED_BUTTON_MIN_HEIGHT,
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    borderWidth: 1,
  },
  label: {
    lineHeight: LABEL_LINE_HEIGHT,
    textAlign: 'center',
    marginTop: LABEL_TOP_MARGIN,
  },
});
