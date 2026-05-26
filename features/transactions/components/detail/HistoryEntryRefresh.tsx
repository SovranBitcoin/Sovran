import React from 'react';
import { StyleSheet } from 'react-native';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';
import opacity from 'hex-color-opacity';

import type { HistoryEntry } from '@cashu/coco-core';

import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
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
        ? historyEntry.state === 'finalized'
          ? 'Received with'
          : 'Receiving with'
        : 'Processing with';

  const row = (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <MintIcon
          iconUrl={mintInfo?.icon_url}
          size={40}
          name={mintInfo?.name}
          isLoading={loading}
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
      <GradientCard style={styles.card}>
        <ListGroup variant="transparent">
          {onPress ? (
            <PressableFeedback animation={false} onPress={onPress}>
              <PressableFeedback.Scale>{row}</PressableFeedback.Scale>
              <PressableFeedback.Ripple />
            </PressableFeedback>
          ) : (
            row
          )}
        </ListGroup>
      </GradientCard>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
});
