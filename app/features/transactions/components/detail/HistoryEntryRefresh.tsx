import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import type { GetInfoResponse } from '@cashu/cashu-ts';
import { ListGroup, PressableFeedback } from 'heroui-native';
import { withAlpha } from '@/shared/lib/color';
import { getHistoryEntryRefreshLabel } from 'wallet';

import type { HistoryEntry } from '@cashu/coco-core';

import Icon from 'assets/icons';
import { MintIcon } from '@/shared/ui/composed/MintIcon';
import { Skeleton } from '@/shared/ui/primitives/Skeleton';
import { SkeletonContentCrossfade } from '@/shared/ui/composed/SkeletonContentCrossfade';
import { GradientCard } from '@/shared/ui/composed/GradientCard';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { usePaymentCopyResolver } from '@/shared/hooks/usePaymentCopyResolver';
import { Log, paymentLog } from '@/shared/lib/logger';

interface HistoryEntryRefreshProps {
  mintInfo?: GetInfoResponse | null;
  historyEntry: Partial<HistoryEntry> & { type: HistoryEntry['type']; state?: string };
  onPress?: () => void;
  /** Pass BOTH testID and accessibilityLabel or the row is AX-invisible on iOS. */
  testID?: string;
  accessibilityLabel?: string;
}

export function HistoryEntryRefresh({
  mintInfo,
  historyEntry,
  onPress,
  testID,
  accessibilityLabel,
}: HistoryEntryRefreshProps) {
  const foreground = useThemeColor('foreground');
  const paymentCopy = usePaymentCopyResolver();
  const loading = !mintInfo;
  const text = paymentCopy.text;
  const statusLabel = getHistoryEntryRefreshLabel(historyEntry, paymentCopy);

  useEffect(() => {
    paymentLog.debug('tx.history_refresh.render', {
      type: historyEntry.type,
      state: historyEntry.state ?? null,
      loading,
      hasMintInfo: !!mintInfo,
      hasMintName: !!mintInfo?.name,
      hasMintIcon: !!mintInfo?.icon_url,
      statusLabelLength: statusLabel.length,
      editable: !!onPress,
    });
  }, [historyEntry, loading, mintInfo, onPress, statusLabel.length]);

  const row = (
    <ListGroup.Item disabled>
      <ListGroup.ItemPrefix>
        <MintIcon
          iconUrl={mintInfo?.icon_url}
          size={40}
          name={mintInfo?.name}
          isLoading={loading}
          alt={`${mintInfo?.name || text('history.refresh.mintAlt')} icon`}
        />
      </ListGroup.ItemPrefix>
      <ListGroup.ItemContent>
        <ListGroup.ItemTitle className="font-normal">{statusLabel}</ListGroup.ItemTitle>
        <SkeletonContentCrossfade
          loading={loading}
          wave="none"
          visualKey="history-refresh-name"
          visualSurface="transactions"
          renderSkeleton={() => <Skeleton className="mt-1 h-4 w-28 rounded-md" />}
          renderContent={() => (
            <ListGroup.ItemDescription className="text-foreground text-base font-bold">
              {mintInfo?.name}
            </ListGroup.ItemDescription>
          )}
        />
      </ListGroup.ItemContent>
      {onPress && (
        <ListGroup.ItemSuffix>
          <Icon name="lucide:pencil-line" size={16} color={withAlpha(foreground, 0.4)} />
        </ListGroup.ItemSuffix>
      )}
    </ListGroup.Item>
  );

  return (
    <Log name="HistoryEntryRefresh">
      <GradientCard style={styles.card}>
        <ListGroup variant="transparent">
          {onPress ? (
            <PressableFeedback
              animation={false}
              testID={testID}
              accessibilityLabel={accessibilityLabel}
              onPress={() => {
                paymentLog.info('tx.history_refresh.press', {
                  type: historyEntry.type,
                  state: historyEntry.state ?? null,
                  hasMintInfo: !!mintInfo,
                });
                onPress();
              }}>
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
