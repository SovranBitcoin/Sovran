import React, { useEffect } from 'react';

import { HistoryEntry } from '@cashu/coco-core';
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
import { amountToNumber, type AmountValue } from '@/shared/lib/cashu/amount';
import { isOutgoingTransaction } from '@/shared/lib/utils';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { Log, paymentLog } from '@/shared/lib/logger';

import TransactionIcon from '../TransactionIcon';

interface HistoryEntryHeaderProps {
  /** History entry (optional if using pendingData) */
  historyEntry?: HistoryEntry;
  /** Pending data for payment request mode before token is created */
  pendingData?: {
    amount: AmountValue;
    unit: string;
    type: 'send' | 'receive';
  };
  /**
   * Nostr pubkey (hex) of the recipient — surfaces a Nostr-themed avatar
   * with an outgoing-arrow overlay in place of the default transaction
   * icon. Profile picture / display name are resolved from the metadata
   * cache. Set by the chat→send-money flow via
   * `entry.metadata.recipientPubkey` (see `colada` types).
   */
  recipientPubkey?: string;
  /** Whether recipientPubkey should replace the transaction icon with an avatar. */
  showRecipientAvatar?: boolean;
  /** Show loading state on the icon */
  isLoading?: boolean;
}

export function HistoryEntryHeader({
  historyEntry,
  pendingData,
  recipientPubkey,
  showRecipientAvatar = true,
  isLoading,
}: HistoryEntryHeaderProps) {
  const avatarRecipientPubkey = showRecipientAvatar ? recipientPubkey : undefined;
  const { metadata: recipientMetadata } = useNostrProfileMetadata(avatarRecipientPubkey);
  const [foreground, surface, background, danger, success] = useThemeColor([
    'foreground',
    'surface',
    'background',
    'danger',
    'success',
  ] as const);

  // Determine values from either historyEntry or pendingData
  const amount = historyEntry?.amount ?? pendingData?.amount ?? 0;
  const numericAmount = amountToNumber(amount);
  const unit = historyEntry?.unit ?? pendingData?.unit ?? 'sat';
  const type = historyEntry?.type ?? pendingData?.type ?? 'send';

  const isSend = isOutgoingTransaction({ type });
  const isReceive = !isSend;

  useEffect(() => {
    paymentLog.debug('tx.history_header.render', {
      hasHistoryEntry: !!historyEntry,
      hasPendingData: !!pendingData,
      type,
      state: String((historyEntry as { state?: unknown } | undefined)?.state ?? ''),
      amount: numericAmount,
      unit,
      direction: isSend ? 'send' : 'receive',
      isLoading: !!isLoading,
      showRecipientAvatar,
      recipientPubkeyLength: recipientPubkey?.length ?? 0,
      hasRecipientMetadata: !!recipientMetadata,
      hasRecipientPicture: !!recipientMetadata?.picture,
      hasRecipientName: !!(recipientMetadata?.displayName ?? recipientMetadata?.name),
    });
  }, [
    historyEntry,
    isLoading,
    isSend,
    numericAmount,
    pendingData,
    recipientMetadata,
    recipientPubkey,
    showRecipientAvatar,
    type,
    unit,
  ]);

  // Avatar size and icon overlay size for recipient mode
  const avatarSize = 48;
  const iconOverlaySize = 24;

  const renderIcon = () => {
    if (avatarRecipientPubkey) {
      const recipientName = recipientMetadata?.displayName ?? recipientMetadata?.name;
      return (
        <View className="relative">
          <Avatar
            state={recipientMetadata?.picture ? 'image' : 'fallback'}
            picture={recipientMetadata?.picture}
            seed={avatarRecipientPubkey}
            size={avatarSize}
            name={recipientName}
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
    <Log name="HistoryEntryHeader">
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
              { amount: Math.abs(numericAmount), unit },
              {
                displayAs: unit === 'usd' ? 'sats' : 'usd',
                currencyDisplay: unit === 'usd' ? 'name' : 'symbol',
              }
            )}
          </Text>
        </VStack>
        {renderIcon()}
      </HStack>
    </Log>
  );
}
