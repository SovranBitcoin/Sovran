import React from 'react';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { Spinner } from '@/shared/ui/primitives/Spinner';
import { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { Log } from '@/shared/lib/logger';

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

  const getIconName = () => {
    // Check if this is a rolled back send transaction
    if (historyEntry.type === 'send') {
      const sendEntry = historyEntry as SendHistoryEntry;
      const sendState = String(sendEntry.state);
      if (sendState === 'rolledBack' || sendState === 'rolled_back') {
        return 'mdi:cancel'; // Cancelled/rolled back icon
      }
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
  };

  return (
    <Log name="TransactionIcon">
      <View
        className="h-7 w-7 shrink-0 items-center justify-center bg-transparent"
        style={{ marginTop: 6 }}>
        {isLoading ? (
          <Spinner size={22} color={foreground} />
        ) : (
          <Icon name={getIconName()} color={foreground} size={24} />
        )}
      </View>
    </Log>
  );
}
