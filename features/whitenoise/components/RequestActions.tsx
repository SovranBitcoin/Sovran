import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Text } from '@/shared/ui/primitives/Text';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface RequestActionsProps {
  onAccept: () => void;
  onDecline: () => void;
  isBusy?: boolean;
  /** Hide the labels and use a more compact form (icon-only, future). */
  compact?: boolean;
}

/**
 * Accept / Decline pair rendered as the trailing slot of a Contacts >
 * Requests row. Compact two-button row matched to the existing surface
 * tokens.
 */
export function RequestActions({ onAccept, onDecline, isBusy }: RequestActionsProps) {
  const [accent, accentForeground, danger, dangerForeground] = useThemeColor([
    'accent',
    'accent-foreground',
    'danger',
    'danger-foreground',
  ] as const);

  if (isBusy) {
    return (
      <HStack align="center" justify="center" style={{ width: 110 }}>
        <ActivityIndicator size="small" color={accent} />
      </HStack>
    );
  }

  return (
    <HStack spacing={6} align="center">
      <Pressable
        onPress={onDecline}
        hitSlop={6}
        style={[styles.button, { backgroundColor: danger }]}
        testID="whitenoise-request-decline">
        <Text size={13} bold style={{ color: dangerForeground }}>
          Decline
        </Text>
      </Pressable>
      <Pressable
        onPress={onAccept}
        hitSlop={6}
        style={[styles.button, { backgroundColor: accent }]}
        testID="whitenoise-request-accept">
        <Text size={13} bold style={{ color: accentForeground }}>
          Accept
        </Text>
      </Pressable>
    </HStack>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
});
