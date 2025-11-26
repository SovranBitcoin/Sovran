/**
 * @fileoverview Standalone meltQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MeltQuoteResponse } from '@cashu/cashu-ts';
import { MeltHistoryEntry } from 'coco-cashu-core';
import { MeltQuoteScreen } from 'components/screens/MeltQuoteScreen';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';

function ModalScreen() {
  const { meltQuote: meltQuoteString, meltHistoryEntry: meltHistoryEntryString } =
    useLocalSearchParams<{
      meltQuote?: string;
      meltHistoryEntry?: string;
    }>();
  const { getPrimaryColor } = useTheme();

  const meltQuote = meltQuoteString
    ? (JSON.parse(meltQuoteString) as MeltQuoteResponse)
    : undefined;
  const meltHistoryEntry = meltHistoryEntryString
    ? (JSON.parse(meltHistoryEntryString) as MeltHistoryEntry)
    : undefined;

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <CloseButton />,
        }}
      />
      <MeltQuoteScreen
        meltQuote={meltQuote}
        meltHistoryEntry={meltHistoryEntry}
        onCancel={() => {
          router.dismissAll();
          router.push('/(drawer)/(tabs)');
        }}
      />
    </>
  );
}

export default withSheetProvider(ModalScreen);
