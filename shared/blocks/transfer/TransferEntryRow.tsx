/**
 * @fileoverview Reusable transfer entry row
 *
 * Displays a single send/receive row with:
 * - 36px avatar with small upload/download arrow badge
 * - Mint name (bold)
 * - Colored amount (red for send, green for receive) via AmountFormatter
 * - Subtitle line (timestamp, fiat, status text, etc.)
 * - Optional status icon slot
 * - Optional onPress handler
 *
 * Used by both SwapTransactionScreen (expanded view) and RebalanceStepRow.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import opacity from 'hex-color-opacity';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { View } from '@/shared/ui/primitives/View/View';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import Icon from 'assets/icons';

interface TransferEntryRowProps {
  /** Whether this row represents a send or receive */
  type: 'send' | 'receive';
  /** Mint avatar URL */
  mintIconUrl?: string;
  /** Mint display name */
  mintName: string;
  /** Amount to display */
  amount: number;
  /** Unit for AmountFormatter */
  unit: string;
  /** Left-side subtitle (e.g. timestamp or status text) */
  subtitle?: string;
  /** Color for the left-side subtitle */
  subtitleColor?: string;
  /** Right-side subtitle (e.g. fiat amount) */
  secondarySubtitle?: string;
  /** Color for the right-side subtitle */
  secondarySubtitleColor?: string;
  /** Optional press handler for the row */
  onPress?: () => void;
  /** Optional trailing status icon (rendered after the amount) */
  statusIcon?: React.ReactNode;
}

export const TransferEntryRow = React.memo(
  ({
    type,
    mintIconUrl,
    mintName,
    amount,
    unit,
    subtitle,
    subtitleColor,
    secondarySubtitle,
    secondarySubtitleColor,
    onPress,
    statusIcon,
  }: TransferEntryRowProps) => {
    const [foreground, surfaceSecondary, danger, success] = useThemeColor([
      'foreground',
      'surface-secondary',
      'danger',
      'success',
    ] as const);

    const isSend = type === 'send';
    const amountColor = isSend ? danger : success;
    const defaultSubtitleColor = opacity(foreground, 0.8);

    const content = (
      <HStack spacing={12} flex={1}>
        {/* Avatar with small arrow overlay */}
        <View style={styles.avatarWrapper}>
          <Avatar picture={mintIconUrl} size={36} name={mintName} />
          <View style={[styles.arrowBadge, { backgroundColor: surfaceSecondary }]}>
            <Icon
              name={isSend ? 'fluent:arrow-upload-16-filled' : 'fluent:arrow-download-16-filled'}
              size={10}
              color="#fff"
            />
          </View>
        </View>

        <VStack spacing={0} flex={1}>
          <HStack justify="space-between" align="flex-end">
            <UntranslatedText color={foreground} bold size={14} numberOfLines={1}>
              {mintName}
            </UntranslatedText>
            <HStack align="center" spacing={0}>
              <UntranslatedText overpass color={amountColor} bold size={16}>
                {isSend ? '- ' : '+ '}
              </UntranslatedText>
              <AmountFormatter
                amount={amount}
                unit={unit}
                size={16}
                weight="heavy"
                color={amountColor}
              />
              {statusIcon ? <View style={styles.statusIconSlot}>{statusIcon}</View> : null}
            </HStack>
          </HStack>

          {(subtitle || secondarySubtitle) && (
            <HStack justify="space-between" align="center">
              {subtitle ? (
                <UntranslatedText size={10} color={subtitleColor ?? defaultSubtitleColor}>
                  {subtitle}
                </UntranslatedText>
              ) : (
                <View />
              )}
              {secondarySubtitle ? (
                <UntranslatedText
                  overpass
                  bold
                  size={10}
                  color={secondarySubtitleColor ?? defaultSubtitleColor}>
                  {secondarySubtitle}
                </UntranslatedText>
              ) : null}
            </HStack>
          )}
        </VStack>
      </HStack>
    );

    if (onPress) {
      return (
        <TouchableOpacity style={styles.entryRow} onPress={onPress}>
          {content}
        </TouchableOpacity>
      );
    }

    return <View style={styles.entryRow}>{content}</View>;
  }
);
TransferEntryRow.displayName = 'TransferEntryRow';

const styles = StyleSheet.create({
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    padding: 20,
    paddingLeft: 16,
    paddingRight: 16,
  },
  avatarWrapper: {
    position: 'relative',
    width: 36,
    height: 36,
  },
  arrowBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconSlot: {
    marginLeft: 6,
  },
});
