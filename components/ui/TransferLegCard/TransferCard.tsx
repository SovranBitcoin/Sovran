/**
 * @fileoverview Reusable BlurCardFrame card wrapper for transfer entries
 *
 * Provides the rounded card container with blur background and accent
 * gradient highlights — matching the exact same card treatment used by
 * the Transactions component on the home page:
 *   accentColor = primaryColor('300')
 *   borderColor = opacity(accentColor, 0.3)
 *
 * Used by both SwapTransactionScreen and RebalanceStepRow.
 */

import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import { View } from 'components/ui/View/View';
import { BlurCardFrame } from 'components/ui/BlurCardFrame';

interface TransferCardProps {
  /** Accent color for the BlurCardFrame gradients. Falls back to primary-300. */
  accentColor?: string;
  /** Children to render inside the card. */
  children: React.ReactNode;
}

export const TransferCard = React.memo(
  ({ accentColor: accentColorProp, children }: TransferCardProps) => {
    const { getPrimaryColor } = useTheme();

    const accentColor = useMemo(
      () => accentColorProp ?? getPrimaryColor('300'),
      [accentColorProp, getPrimaryColor]
    );

    // Always show the tinted border — matches Transactions component exactly.
    const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);

    return (
      <View style={[styles.card, { borderColor }]}>
        <BlurCardFrame accentColor={accentColor}>
          <View style={styles.content}>{children}</View>
        </BlurCardFrame>
      </View>
    );
  }
);
TransferCard.displayName = 'TransferCard';

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    borderWidth: 1,
  },
  content: {
    zIndex: 1,
  },
});
