import React from 'react';
import { ActivityIndicator } from 'react-native';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { HistoryEntry, SendHistoryEntry } from 'coco-cashu-core';

interface TransactionIconProps {
  historyEntry: HistoryEntry;
  /** Show a loading spinner instead of the icon */
  isLoading?: boolean;
}

export default function TransactionIcon({
  historyEntry,
  isLoading,
}: TransactionIconProps): React.ReactNode {
  const { getPrimaryColor } = useTheme();

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
        <ActivityIndicator size="small" color={getPrimaryColor('50')} />
      ) : (
        <Icon name={getIconName()} color={getPrimaryColor('50')} size={28} />
      )}
    </View>
  );
}
