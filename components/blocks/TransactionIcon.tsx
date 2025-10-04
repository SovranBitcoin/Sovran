import React from 'react';
import { View } from 'components/ui/View';
import Icon from 'assets/icons';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { HistoryEntry } from 'coco-cashu-core';

interface TransactionIconProps {
  historyEntry: HistoryEntry;
}

export default function TransactionIcon({ historyEntry }: TransactionIconProps): React.ReactNode {
  const theme = useSelector(memoizedGetTheme);

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
      <Icon name={getIconName(historyEntry.type)} color={greys(theme)[50]} size={28} />
    </View>
  );
}
