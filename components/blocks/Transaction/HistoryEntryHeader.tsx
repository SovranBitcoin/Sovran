import React from 'react';
import { Text } from 'components/ui/Text';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import opacity from 'hex-color-opacity';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { formatAmount } from 'helper/currency';
import { Avatar } from 'components/ui/Avatar';
import TransactionIcon from '../TransactionIcon';
import Icon from 'assets/icons';
import { HistoryEntry } from 'coco-cashu-core';
import { useThemeColor } from 'hooks/useThemeColor';

/** Recipient profile data for payment request mode */
interface RecipientProfile {
  pubkey: string;
  picture?: string;
  displayName?: string;
}

interface HistoryEntryHeaderProps {
  /** History entry (optional if using pendingData) */
  historyEntry?: HistoryEntry;
  /** Pending data for payment request mode before token is created */
  pendingData?: {
    amount: number;
    unit: string;
    type: 'send' | 'receive';
  };
  /** Recipient profile for payment request mode */
  recipientProfile?: RecipientProfile;
  /** Show loading state on the icon */
  isLoading?: boolean;
}

export function HistoryEntryHeader({
  historyEntry,
  pendingData,
  recipientProfile,
  isLoading,
}: HistoryEntryHeaderProps) {
  const [foreground, surface, background, danger, success] = useThemeColor([
    'foreground',
    'surface',
    'background',
    'danger',
    'success',
  ] as const);

  // Determine values from either historyEntry or pendingData
  const amount = historyEntry?.amount ?? pendingData?.amount ?? 0;
  const unit = historyEntry?.unit ?? pendingData?.unit ?? 'sat';
  const type = historyEntry?.type ?? pendingData?.type ?? 'send';

  // Determine if this is a send or receive transaction
  const isSend = type === 'send' || type === 'melt';
  const isReceive = type === 'mint' || type === 'receive';

  // Avatar size and icon overlay size for recipient mode
  const avatarSize = 48;
  const iconOverlaySize = 24;

  // Render the icon section - either recipient avatar or transaction icon
  const renderIcon = () => {
    if (recipientProfile) {
      // Payment request mode - show recipient avatar with send icon overlay
      return (
        <View style={{ position: 'relative' }}>
          <Avatar
            picture={recipientProfile.picture}
            seed={recipientProfile.pubkey}
            size={avatarSize}
            variant="person"
            name={recipientProfile.displayName}
          />
          {/* Small send icon in bottom right corner */}
          <View
            style={{
              position: 'absolute',
              bottom: -4,
              right: -4,
              backgroundColor: surface,
              borderRadius: iconOverlaySize / 2,
              width: iconOverlaySize,
              height: iconOverlaySize,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 2,
              borderColor: background,
            }}>
            <Icon
              name="fluent:arrow-upload-16-filled"
              color={opacity(foreground, 0.9)}
              size={iconOverlaySize - 8}
            />
          </View>
        </View>
      );
    }

    // Normal mode - show transaction icon
    if (historyEntry) {
      return (
        <View className="scale-125 transform bg-transparent p-4">
          <TransactionIcon historyEntry={historyEntry} isLoading={isLoading} />
        </View>
      );
    }

    // Fallback for pending data without history entry
    return (
      <View className="scale-125 transform bg-transparent p-4">
        <Icon
          name={isSend ? 'fluent:arrow-upload-16-filled' : 'fluent:arrow-download-16-filled'}
          color={opacity(foreground, 0.9)}
          size={28}
        />
      </View>
    );
  };

  return (
    <HStack align="center" justify="space-between" className="p-5 pb-0 pt-0">
      <VStack>
        <HStack align="center">
          <Spacer size={8} />
          <Text size={isSend ? 32 : 24} color={isSend ? danger : success} style={{ opacity: 0.9 }}>
            {isSend ? '-' : '+'}
          </Text>
          <Spacer size={8} />
          <AmountFormatter
            amount={amount}
            unit={unit}
            size={28}
            weight="heavy"
            color={isReceive ? success : danger}
          />
        </HStack>
        <Text size={18} color={opacity(foreground, 0.66)} bold>
          {amount < 0 ? '-' : ''}
          <Text size={18} color={opacity(foreground, 0.9)} style={{ marginLeft: 8 }}>
            {amount < 0 ? '-' : ''}
            {formatAmount(
              { amount: Math.abs(amount), unit },
              {
                displayAs: unit === 'usd' ? 'sats' : 'usd',
                currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
              }
            )}
          </Text>
        </Text>
      </VStack>
      {renderIcon()}
    </HStack>
  );
}
