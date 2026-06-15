import React, { useEffect, useMemo } from 'react';
import { isSendTokenCancelled } from '@sovranbitcoin/colada';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { HistoryEntry } from '@cashu/coco-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log, paymentLog } from '@/shared/lib/logger';

interface TransactionIconProps {
  historyEntry: HistoryEntry;
  /** Show a loading spinner instead of the icon */
  isLoading?: boolean;
}

export default function TransactionIcon({
  historyEntry,
  isLoading,
}: TransactionIconProps): React.ReactNode {
  const foreground = useThemeColor('foreground');
  const cancelledSend = historyEntry.type === 'send' && isSendTokenCancelled(historyEntry);

  const iconName = useMemo(() => {
    // Check if this is a rolled back send transaction
    if (cancelledSend) {
      return 'mdi:cancel'; // Cancelled/rolled back icon
    }

    switch (historyEntry.type) {
      case 'mint':
        return 'fluent:arrow-download-16-filled'; // Receiving from Lightning
      case 'melt':
        return 'fluent:arrow-upload-16-filled'; // Sending to Lightning
      case 'receive':
        return 'fluent:arrow-download-16-filled'; // Receiving ecash
      case 'send':
        return 'fluent:arrow-upload-16-filled'; // Sending ecash
      default:
        return 'fluent:circle-16-filled';
    }
  }, [cancelledSend, historyEntry.type]);

  useEffect(() => {
    paymentLog.debug('tx.icon.render', {
      type: historyEntry.type,
      state: String((historyEntry as { state?: unknown }).state ?? ''),
      isLoading: !!isLoading,
      cancelledSend,
      iconName,
    });
  }, [cancelledSend, historyEntry, iconName, isLoading]);

  return (
    <Log name="TransactionIcon">
      <View
        className="h-7 w-7 shrink-0 items-center justify-center bg-transparent"
        style={{ marginTop: 6 }}>
        {isLoading ? (
          <Spinner size={22} color={foreground} />
        ) : (
          <Icon name={iconName} color={foreground} size={24} />
        )}
      </View>
    </Log>
  );
}
