import React from 'react';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import type { HistoryEntry } from '@cashu/coco-core';

import Icon from 'assets/icons';
import { Avatar } from '@/shared/ui/primitives/Avatar';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { View } from '@/shared/ui/primitives/View/View';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

interface HistoryEntryRefreshProps {
  mintInfo?: GetInfoResponse | null;
  historyEntry: Partial<HistoryEntry> & { type: HistoryEntry['type']; state?: string };
  onPress?: () => void;
}

export function HistoryEntryRefresh({ mintInfo, historyEntry, onPress }: HistoryEntryRefreshProps) {
  const foreground = useThemeColor('foreground');
  const loading = !mintInfo;

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
          state={loading ? 'loading' : mintInfo?.icon_url ? 'image' : 'fallback'}
          picture={mintInfo?.icon_url || undefined}
          size={40}
          name={mintInfo?.name}
          alt={`${mintInfo?.name || 'Mint'} icon`}
        />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className="font-normal">{statusLabel}</ListGroup.ItemTitle>
        {loading ? (
          <Skeleton className="mt-1 h-4 w-28 rounded-md" />
        ) : (
          <ListGroup.ItemDescription className="text-foreground text-base font-bold">
            {mintInfo?.name}
          </ListGroup.ItemDescription>
        )}
      </ListGroup.ItemContent>
      {onPress && (
        <ListGroup.ItemSuffix>
          <Icon name="lucide:pencil-line" size={16} color={opacity(foreground, 0.4)} />
        </ListGroup.ItemSuffix>
      )}
    </ListGroup.Item>
  );

  return (
    <Log name="HistoryEntryRefresh">
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
    </Log>
  );
}
