import React from 'react';
import { View } from 'components/ui/View/View';
import { Avatar } from 'components/ui/Avatar';
import Icon from 'assets/icons';
import { HistoryEntry } from 'coco-cashu-core';
import { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { useTheme } from 'providers/ThemeProvider';
import opacity from 'hex-color-opacity';

interface HistoryEntryRefreshProps {
  mintInfo: GetInfoResponse;
  historyEntry: Partial<HistoryEntry> & { type: HistoryEntry['type'] };
  handleCheckStatus?: (onClose: () => void) => Promise<void>;
  onPress?: () => void;
}

export function HistoryEntryRefresh({ mintInfo, historyEntry, onPress }: HistoryEntryRefreshProps) {
  const { getPrimaryColor } = useTheme();

  const statusLabel =
    historyEntry.type === 'send'
      ? 'state' in historyEntry && historyEntry.state === 'finalized'
        ? 'Sent with'
        : 'Sending with'
      : historyEntry.type === 'receive'
        ? 'state' in historyEntry &&
          typeof (historyEntry as any).state === 'string' &&
          (historyEntry as any).state === 'redeemed'
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
        <ListGroup.ItemTitle>{statusLabel}</ListGroup.ItemTitle>
        <ListGroup.ItemDescription>{mintInfo?.name}</ListGroup.ItemDescription>
      </ListGroup.ItemContent>
      {onPress && (
        <ListGroup.ItemSuffix>
          <Icon name="lucide:pencil-line" size={16} color={opacity(getPrimaryColor('0'), 0.4)} />
        </ListGroup.ItemSuffix>
      )}
    </ListGroup.Item>
  );

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginBottom: 0,
      }}>
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
