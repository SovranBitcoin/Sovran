/**
 * @fileoverview Standalone sendToken route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * Param parsing and error handling is done by SendTokenScreen.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { SendTokenScreen } from 'components/screens/SendTokenScreen';

function ModalScreen() {
  const { sendHistoryEntry } = useLocalSearchParams<{ sendHistoryEntry: string }>();

  return (
    <SendTokenScreen sendHistoryEntry={sendHistoryEntry} onNavigateBack={() => router.back()} />
  );
}

export default withSheetProvider(ModalScreen);
