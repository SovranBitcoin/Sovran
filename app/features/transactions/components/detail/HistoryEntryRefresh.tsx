import { getMintDisplayName } from '@/shared/lib/url';
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
import { Surface } from '@/shared/ui/composed/Surface';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useStylePaint } from '@/shared/styles/appStyle';
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
  // On a bare surface the row sits on the screen gutter like the amount
  // above it; a framed surface keeps the item's own inset.
  const { cardIsBare } = useStylePaint();
  const paymentCopy = usePaymentCopyResolver();
  // A mint that cannot be reached never sends its info. Its address is known
  // from the payment itself, so the row names the mint by host at once and
  // takes the mint's own name if it arrives; it only waits when there is no
  // address to show.
  const mintName =
    mintInfo?.name || (historyEntry.mintUrl ? getMintDisplayName(historyEntry.mintUrl) : '');
  const loading = !mintInfo && mintName === '';
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
    <ListGroup.Item disabled className={cardIsBare ? 'px-0' : undefined}>
      <ListGroup.ItemPrefix>
        <MintIcon
          iconUrl={mintInfo?.icon_url}
          size={40}
          name={mintName}
          isLoading={loading}
          alt={`${mintName || text('history.refresh.mintAlt')} icon`}
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
              {mintName}
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
      <Surface style={styles.card}>
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
      </Surface>
    </Log>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
  },
});
