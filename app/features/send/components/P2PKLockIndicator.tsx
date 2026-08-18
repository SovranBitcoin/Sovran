import React from 'react';
import { StyleSheet } from 'react-native';
import { withAlpha } from '@/shared/lib/color';

import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { alpha, radius, spacing } from '@/shared/styles/tokens';

type P2PKLockState = {
  p2pkLockPubkey?: unknown;
  p2pkPubkey?: unknown;
  metadata?: Record<string, unknown> | null;
};

/** Presence-only detector; it never returns or formats the public lock key. */
export function hasP2PKLock(state: P2PKLockState | null | undefined): boolean {
  if (!state) return false;
  if (typeof state.p2pkLockPubkey === 'string' && state.p2pkLockPubkey.length > 0) return true;
  if (state.p2pkPubkey != null) return true;
  const metadata = state.metadata;
  return Boolean(
    metadata &&
    ((typeof metadata.p2pkLockPubkey === 'string' && metadata.p2pkLockPubkey.length > 0) ||
      metadata.p2pkPubkey != null)
  );
}

export function P2PKLockIndicator(): React.ReactElement {
  const [foreground, surfaceSecondary] = useThemeColor([
    'foreground',
    'surface-secondary',
  ] as const);
  const indicatorStyle = React.useMemo(
    () => [
      styles.indicator,
      {
        backgroundColor: surfaceSecondary,
        borderColor: withAlpha(foreground, alpha.subtle),
      },
    ],
    [foreground, surfaceSecondary]
  );
  const textStyle = React.useMemo(
    () => ({ color: withAlpha(foreground, alpha.strong) }),
    [foreground]
  );
  return (
    <HStack
      testID="p2pk-lock-indicator"
      accessible
      accessibilityRole="text"
      accessibilityLabel="P2PK lock enabled"
      gap={spacing.xs}
      style={indicatorStyle}>
      <Icon name="mdi:lock-outline" size={14} color={withAlpha(foreground, alpha.strong)} />
      <Text size={12} bold style={textStyle}>
        P2PK locked
      </Text>
    </HStack>
  );
}

const styles = StyleSheet.create({
  indicator: {
    alignSelf: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
