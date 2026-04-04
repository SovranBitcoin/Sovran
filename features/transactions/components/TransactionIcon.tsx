import React from 'react';
import { ActivityIndicator } from 'react-native';
import { View } from '@/shared/ui/primitives/View/View';
import Icon from 'assets/icons';
import { HistoryEntry, SendHistoryEntry } from '@cashu/coco-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

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
      if (sendEntry.state === 'rolledBack') {
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
    <View className="relative h-7 w-7 items-center justify-center bg-transparent">
      {isLoading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <Icon name={getIconName()} color={foreground} size={28} />
      )}
    </View>
  );
}
