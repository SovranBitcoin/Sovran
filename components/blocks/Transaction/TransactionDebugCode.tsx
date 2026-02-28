import React from 'react';
import { ScrollView } from 'react-native';
import { Text } from 'components/ui/Text';
import { View } from 'components/ui/View/View';
import { HistoryEntry } from 'coco-cashu-core';

interface HistoryEntryDebugCodeProps {
  historyEntry: HistoryEntry;
}

function HistoryEntryDebugCode({ historyEntry }: HistoryEntryDebugCodeProps) {
  return null;
  // eslint-disable-next-line no-unreachable
  return (
    <ScrollView horizontal>
      <View
        blur
        className="bg-surface-secondary"
        style={{
          padding: 16,
          marginHorizontal: 16,
          borderRadius: 8,
        }}>
        <Text mono>{JSON.stringify(historyEntry, null, 2)}</Text>
      </View>
    </ScrollView>
  );
}

// Keep the old export for backward compatibility
export const TransactionDebugCode = HistoryEntryDebugCode;
