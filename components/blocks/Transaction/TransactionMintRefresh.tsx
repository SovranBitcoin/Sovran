import React from 'react';
import { View, HStack, VStack, Spacer } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { Avatar } from 'components/ui/Avatar';
import { HistoryEntry } from 'coco-cashu-core';
import { GetInfoResponse } from '@cashu/cashu-ts';

interface HistoryEntryMintRefreshProps {
  mintInfo: GetInfoResponse;
  historyEntry: HistoryEntry;
  handleCheckStatus?: (onClose: () => void) => Promise<void>;
}

export function HistoryEntryMintRefresh({ mintInfo, historyEntry }: HistoryEntryMintRefreshProps) {
  return (
    <HStack
      align="center"
      justify="space-between"
      className="rounded-lg bg-primary-800"
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
        padding: 16,
      }}>
      <HStack align="center" gap={4}>
        <View>
          <Avatar
            picture={mintInfo?.icon_url || undefined}
            size={40}
            variant="mint"
            name={mintInfo?.name}
            alt={`${mintInfo?.name || 'Mint'} icon`}
          />
        </View>
        <Spacer size={12} />
        <VStack>
          <Text heavy size={16}>
            {historyEntry.type === 'send'
              ? 'state' in historyEntry && historyEntry.state === 'PAID'
                ? 'Sent with'
                : 'Sending with'
              : 'state' in historyEntry && historyEntry.state === 'PAID'
                ? 'Received with'
                : 'Receiving with'}
          </Text>
          <Text regular size={16} className="text-primary-50">
            {mintInfo?.name}
          </Text>
        </VStack>
      </HStack>
    </HStack>
  );
}

// Keep the old export for backward compatibility
export const TransactionMintRefresh = HistoryEntryMintRefresh;
