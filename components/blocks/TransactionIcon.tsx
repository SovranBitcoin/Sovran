import React from 'react';
import { View } from 'components/ui/View/View';
import Icon from 'assets/icons';
import { useTheme } from 'providers/ThemeProvider';
import { HistoryEntry } from 'coco-cashu-core';

interface TransactionIconProps {
  historyEntry: HistoryEntry;
}

export default function TransactionIcon({ historyEntry }: TransactionIconProps): React.ReactNode {
  const { getPrimaryColor } = useTheme();

  const getIconName = (type: string) => {
    switch (type) {
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
    <View className="relative h-7 w-7 bg-transparent">
      <Icon name={getIconName(historyEntry.type)} color={getPrimaryColor('50')} size={28} />
    </View>
  );
}
