import { memoizedGetTheme } from 'helper/redux/settings';
import React from 'react';
import { ScrollView } from 'react-native';
import { useSelector } from 'react-redux';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View';
import { HistoryEntry } from 'coco-cashu-core';

interface HistoryEntryDebugCodeProps {
  historyEntry: HistoryEntry;
}

export function HistoryEntryDebugCode({ historyEntry }: HistoryEntryDebugCodeProps) {
  return null;
  // eslint-disable-next-line no-unreachable
  const theme = useSelector(memoizedGetTheme);
  return (
    <ScrollView horizontal>
      <View
        blur
        style={{
          padding: 16,
          marginHorizontal: 16,
          borderRadius: 8,
          backgroundColor: theme.greys[800],
        }}>
        <Text mono>{JSON.stringify(historyEntry, null, 2)}</Text>
      </View>
    </ScrollView>
  );
}

// Keep the old export for backward compatibility
export const TransactionDebugCode = HistoryEntryDebugCode;
