/**
 * @fileoverview Standalone mintQuote route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import type { MintHistoryEntry } from 'coco-cashu-core';
import { MintQuoteScreen, getFormattedMintQuoteTitle } from 'components/screens/MintQuoteScreen';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';

function ModalScreen() {
  const { mintHistoryEntry: mintHistoryEntryString } = useLocalSearchParams<{
    mintHistoryEntry: string;
  }>();
  const { getPrimaryColor } = useTheme();

  const mintHistoryEntry = JSON.parse(mintHistoryEntryString) as MintHistoryEntry;
  const title = getFormattedMintQuoteTitle(mintHistoryEntry.unit);

  const CloseButton = () => (
    <TouchableOpacity onPress={() => router.back()} style={{ padding: 8 }}>
      <Icon name="material-symbols:close-rounded" size={24} color={getPrimaryColor('0')} />
    </TouchableOpacity>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerTitle: title,
          headerTitleStyle: { color: getPrimaryColor('0') },
          headerTintColor: getPrimaryColor('0'),
          headerLeft: () => <CloseButton />,
        }}
      />
      <MintQuoteScreen mintHistoryEntry={mintHistoryEntry} />
    </>
  );
}

export default withSheetProvider(ModalScreen);
