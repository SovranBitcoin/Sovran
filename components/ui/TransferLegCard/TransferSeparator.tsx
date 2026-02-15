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
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { Spinner } from 'components/ui/Spinner';
import Icon from 'assets/icons';

interface TransferSeparatorProps {
  /** Whether the separator should display in failed/error state (red).
   *  Ignored when `status` is provided. */
  failed?: boolean;
  /** Explicit status — drives the icon and color. Takes precedence over `failed`. */
  status?: 'idle' | 'running' | 'done' | 'failed';
}

export const TransferSeparator = React.memo(({ failed, status }: TransferSeparatorProps) => {
  const { getPrimaryColor, getRedColor, getGreenColor } = useTheme();

  // Derive effective status from props (status takes priority over boolean)
  const effectiveStatus = status ?? (failed ? 'failed' : 'idle');

  const bgColor =
    effectiveStatus === 'done'
      ? getGreenColor('500')
      : effectiveStatus === 'failed'
        ? getRedColor('500')
        : getPrimaryColor('500');

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

  return <View style={[styles.separator, { backgroundColor: bgColor }]}>{renderIcon()}</View>;
});
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
