import React from 'react';

import { HistoryEntry } from 'coco-cashu-core';
import opacity from 'hex-color-opacity';

import Icon from 'assets/icons';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { Spacer } from '@/shared/ui/primitives/View/Spacer';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { formatAmount } from '@/shared/lib/currency';
import { isOutgoingTransaction } from '@/shared/lib/utils';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import TransactionIcon from '../TransactionIcon';

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

  const isSend = isOutgoingTransaction({ type });
  const isReceive = !isSend;

  // Avatar size and icon overlay size for recipient mode
  const avatarSize = 48;
  const iconOverlaySize = 24;

  const renderIcon = () => {
    if (recipientProfile) {
      return (
        <View className="relative">
          <Avatar
            picture={recipientProfile.picture}
            seed={recipientProfile.pubkey}
            size={avatarSize}
            name={recipientProfile.displayName}
          />
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

    if (historyEntry) {
      return (
        <View className="scale-125 transform bg-transparent p-4">
          <TransactionIcon historyEntry={historyEntry} isLoading={isLoading} />
        </View>
      );
    }

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
          <Text
            overpass
            size={isSend ? 32 : 24}
            color={isSend ? danger : success}
            style={{ opacity: 0.9 }}>
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
        <Text overpass size={18} color={opacity(foreground, 0.9)} bold>
          {formatAmount(
            { amount: Math.abs(amount), unit },
            {
              displayAs: unit === 'usd' ? 'sats' : 'usd',
              currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
            }
          )}
        </Text>
      </VStack>
      {renderIcon()}
    </HStack>
  );
}
