/**
 * @fileoverview Reusable error banner for transfer cards
 *
 * Displays a red-tinted banner with an alert icon and error message.
 * Used by both SwapTransactionScreen and RebalanceStepRow.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import Icon from 'assets/icons';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

interface TransferErrorBannerProps {
  /** Error message to display */
  message: string;
}

export const TransferErrorBanner = React.memo(({ message }: TransferErrorBannerProps) => {
  const redColor = useThemeColor('red-400');

  return (
    <View style={[styles.errorBanner, { backgroundColor: opacity(redColor, 0.15) }]}>
      <HStack spacing={8} align="center">
        <Icon name="mdi:alert-circle" size={16} color={redColor} />
        <UntranslatedText size={11} bold color={redColor} style={styles.message}>
          {message}
        </UntranslatedText>
      </HStack>
    </View>
  );
});
TransferErrorBanner.displayName = 'TransferErrorBanner';

const styles = StyleSheet.create({
  errorBanner: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 6,
  },
  message: {
    flex: 1,
  },
});
