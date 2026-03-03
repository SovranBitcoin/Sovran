/**
 * @fileoverview Transactions flow sendToken route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 * Param parsing and error handling is done by SendTokenScreen.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { SendTokenScreen } from '@/features/send';

function ModalScreen() {
  const { sendHistoryEntry } = useLocalSearchParams<{ sendHistoryEntry: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Send Ecash' }} />
      <SendTokenScreen sendHistoryEntry={sendHistoryEntry} onNavigateBack={() => router.back()} />
    </>
  );
}

export default withSheetProvider(ModalScreen);
