import React from 'react';
import { TouchableOpacity } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { View } from 'components/ui/View/View';
import { Spacer } from 'components/ui/View/Spacer';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';
import { Avatar } from 'components/ui/Avatar';
import Icon from 'assets/icons';
import { HistoryEntry } from 'coco-cashu-core';
import { GetInfoResponse } from '@cashu/cashu-ts';

interface HistoryEntryRefreshProps {
  mintInfo: GetInfoResponse;
  historyEntry: Partial<HistoryEntry> & { type: HistoryEntry['type'] };
  handleCheckStatus?: (onClose: () => void) => Promise<void>;
  onPress?: () => void;
}

export function HistoryEntryRefresh({ mintInfo, historyEntry, onPress }: HistoryEntryRefreshProps) {
  const { getPrimaryColor } = useTheme();

  const content = (
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
              ? 'state' in historyEntry && historyEntry.state === 'finalized'
                ? 'Sent with'
                : 'Sending with'
              : historyEntry.type === 'receive'
                ? 'state' in historyEntry &&
                  typeof (historyEntry as any).state === 'string' &&
                  (historyEntry as any).state === 'redeemed'
                  ? 'Received with'
                  : 'Receiving with'
                : 'Processing with'}
          </Text>
          <Text regular size={16} color={opacity(getPrimaryColor('0'), 0.9)}>
            {mintInfo?.name}
          </Text>
        </VStack>
      </HStack>
      {onPress && (
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            // backgroundColor: getPrimaryColor('950'),
            // borderWidth: 1,
            // borderColor: opacity(getPrimaryColor('0'), 0.12),
          }}>
          <Icon name="lucide:pencil-line" size={16} color={getPrimaryColor('300')} />
        </View>
      )}
    </HStack>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
}
