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
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { View } from '@/shared/ui/primitives/View/View';
import { SquircleView } from '@/shared/ui/primitives/SquircleView';
import { BlurCardFrame } from '@/shared/ui/composed/BlurCardFrame';
import { Log } from '@/shared/lib/logger';
import { zIndex } from '@/shared/styles/tokens';

interface TransferCardProps {
  /** Accent color for the BlurCardFrame gradients. Falls back to primary-300. */
  accentColor?: string;
  /** Children to render inside the card. */
  children: React.ReactNode;
}

export const TransferCard = React.memo(
  ({ accentColor: accentColorProp, children }: TransferCardProps) => {
    const muted = useThemeColor('muted');

    const accentColor = useMemo(() => accentColorProp ?? muted, [accentColorProp, muted]);

    // Always show the tinted border — matches Transactions component exactly.
    const borderColor = useMemo(() => opacity(accentColor, 0.3), [accentColor]);

    return (
      <Log name="TransferCard">
        <SquircleView style={[styles.card, { borderColor }]}>
          <BlurCardFrame accentColor={accentColor}>
            <View style={styles.content}>{children}</View>
          </BlurCardFrame>
        </SquircleView>
      </Log>
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
    zIndex: zIndex.raised,
  },
});
