import React from 'react';
import { Text } from 'components/ui/Text';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { useSelector } from 'react-redux';
import { greens, reds } from 'helper/colors';
import { memoizedGetTheme } from 'helper/redux/settings';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { formatAmount } from 'helper/currency';
import TransactionIcon from '../TransactionIcon';
import { HistoryEntry } from 'coco-cashu-core';

interface HistoryEntryHeaderProps {
  historyEntry: HistoryEntry;
}

export function HistoryEntryHeader({ historyEntry }: HistoryEntryHeaderProps) {
  const theme = useSelector(memoizedGetTheme);

  // Determine if this is a send or receive transaction
  const isSend = historyEntry.type === 'send' || historyEntry.type === 'melt';
  const isReceive = historyEntry.type === 'mint' || historyEntry.type === 'receive';

  return (
    <HStack align="center" justify="space-between" className="p-5 pb-0">
      <VStack>
        <HStack align="center">
          <Spacer size={8} />
          <Text size={isSend ? 32 : 24} color={isSend ? reds[300] : greens[300]}>
            {isSend ? '-' : '+'}
          </Text>
          <Spacer size={8} />
          <AmountFormatter
            amount={historyEntry.amount}
            unit={historyEntry.unit}
            size={28}
            weight="heavy"
            color={isReceive ? greens[300] : reds[300]}
          />
        </HStack>
        <Text size={18} color={theme.greys[50]} bold>
          {historyEntry.amount < 0 ? '-' : ''}
          <Text size={18} color={theme.greys[50]} style={{ marginLeft: 8 }}>
            {historyEntry.amount < 0 ? '-' : ''}
            {formatAmount(
              { amount: Math.abs(historyEntry.amount), unit: historyEntry.unit },
              {
                displayAs: historyEntry.unit === 'usd' ? 'sats' : 'usd',
                currencyDisplay: historyEntry.unit === 'usd' ? 'name' : 'symbol',
              }
            )}
          </Text>
        </Text>
      </VStack>
      <View className="scale-125 transform bg-transparent p-4">
        <TransactionIcon historyEntry={historyEntry} />
      </View>
    </HStack>
  );
}

// Keep the old export for backward compatibility
export const TransactionHeader = HistoryEntryHeader;
