/**
 * @fileoverview Reusable colored separator between transfer entries
 *
 * Shows a colored bar between send and receive rows with a status-aware icon:
 * - idle (default): arrow-down icon, primary color
 * - running: spinner, primary color
 * - done: checkmark, green
 * - failed: alert icon, red
 *
 * Used by both SwapTransactionScreen and RebalanceStepRow.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import Icon from 'assets/icons';
import { Log } from '@/shared/lib/logger';

interface TransferSeparatorProps {
  /** Whether the separator should display in failed/error state (red).
   *  Ignored when `status` is provided. */
  failed?: boolean;
  /** Explicit status — drives the icon and color. Takes precedence over `failed`. */
  status?: 'idle' | 'running' | 'done' | 'failed';
}

export const TransferSeparator = ({ failed, status }: TransferSeparatorProps) => {
  const [accent, green500, red500] = useThemeColor(['accent', 'green-500', 'red-500'] as const);

  const effectiveStatus = status ?? (failed ? 'failed' : 'idle');

  const bgColor =
    effectiveStatus === 'done' ? green500 : effectiveStatus === 'failed' ? red500 : accent;

  const renderIcon = () => {
    switch (effectiveStatus) {
      case 'running':
        return <Spinner size={14} />;
      case 'done':
        return <Icon name="mdi:check" size={14} color="#fff" />;
      case 'failed':
        return <Icon name="mdi:alert-circle" size={14} color="#fff" />;
      default:
        return <Icon name="mdi:arrow-down" size={14} color="#fff" />;
    }
  };

  return (
    <Log name="TransferSeparator">
      <View style={[styles.separator, { backgroundColor: bgColor }]}>{renderIcon()}</View>
    </Log>
  );
};
TransferSeparator.displayName = 'TransferSeparator';

const styles = StyleSheet.create({
  separator: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 24,
    marginHorizontal: 16,
    borderRadius: 6,
  },
});
