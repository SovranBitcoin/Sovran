/**
 * Canonical "nothing to show here" surface. One component for every empty
 * state in the app — empty feed, no notifications, no search results, empty
 * transaction list, no nearby bitchatters, etc. — so they stay visually
 * consistent. Generalizes the bespoke centered icon + title + subtitle blocks
 * that previously lived per-screen.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha, spacing } from '@/shared/styles/tokens';
import { Text } from '@/shared/ui/primitives/Text';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { VStack } from '@/shared/ui/primitives/View/VStack';

const EMPTY_STATE_ICON_SIZE = 40;

interface EmptyStateProps {
  /** Iconify glyph name, e.g. `'mdi:message-text'`. */
  icon: string;
  title: string;
  subtitle?: string;
  /** Optional trailing action (e.g. a retry Button or CTA). */
  action?: React.ReactNode;
  /** Glyph size; defaults to the standard empty-state size. */
  iconSize?: number;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  action,
  iconSize = EMPTY_STATE_ICON_SIZE,
}: EmptyStateProps) {
  const [foreground, defaultColor] = useThemeColor(['foreground', 'default'] as const);

  return (
    <VStack align="center" style={styles.container}>
      <Icon name={icon} size={iconSize} color={defaultColor} />
      <Spacer size={spacing.sm} />
      <Text bold size={16} style={{ color: opacity(foreground, alpha.disabled) }}>
        {title}
      </Text>
      {subtitle ? (
        <>
          <Spacer size={spacing.xs} />
          <Text size={13} style={[styles.subtitle, { color: opacity(foreground, alpha.muted) }]}>
            {subtitle}
          </Text>
        </>
      ) : null}
      {action ? (
        <>
          <Spacer size={spacing.lg} />
          {action}
        </>
      ) : null}
    </VStack>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing['4xl'],
    paddingHorizontal: spacing['2xl'],
  },
  subtitle: { textAlign: 'center' },
});
