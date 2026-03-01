import React from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import type { HistoryEntry } from 'coco-cashu-core';

import Icon from 'assets/icons';
import { Avatar } from 'components/ui/Avatar';
import { View } from 'components/ui/View/View';
import { useThemeColor } from 'hooks/useThemeColor';

interface HistoryEntryRefreshProps {
  mintInfo: GetInfoResponse;
  historyEntry: Partial<HistoryEntry> & { type: HistoryEntry['type']; state?: string };
  onPress?: () => void;
}

export function HistoryEntryRefresh({ mintInfo, historyEntry, onPress }: HistoryEntryRefreshProps) {
  const foreground = useThemeColor('foreground');

  const statusLabel =
    historyEntry.type === 'send'
      ? historyEntry.state === 'finalized'
        ? 'Sent with'
        : 'Sending with'
      : historyEntry.type === 'receive'
        ? historyEntry.state === 'redeemed'
          ? 'Received with'
          : 'Receiving with'
        : 'Processing with';

  const row = (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <Avatar
          picture={mintInfo?.icon_url || undefined}
          size={40}
          variant="mint"
          name={mintInfo?.name}
          alt={`${mintInfo?.name || 'Mint'} icon`}
        />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className="font-normal">{statusLabel}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription className="text-foreground text-base font-bold">
          {mintInfo?.name}
        </ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      {onPress && (
        <ListGroup.ItemSuffix>
          <Icon name="lucide:pencil-line" size={16} color={opacity(foreground, 0.4)} />
        </ListGroup.ItemSuffix>
      )}
    </ListGroup.Item>
  );

  return (
    <View className="mx-4">
      <ListGroup variant="secondary">
        {onPress ? (
          <PressableFeedback animation={false} onPress={onPress}>
            <PressableFeedback.Scale>{row}</PressableFeedback.Scale>
            <PressableFeedback.Ripple />
          </PressableFeedback>
        ) : (
          row
        )}
      </ListGroup>
    </View>
  );
}
