/**
 * @fileoverview Send flow sendToken route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The token is created by the confirmSend handler before navigation.
 * This screen only renders the pre-built SendHistoryEntry.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { SendTokenScreen } from '@/features/send';

function ModalScreen() {
  const { sendHistoryEntry } = useLocalSearchParams<{ sendHistoryEntry?: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Send Ecash' }} />
      <SendTokenScreen sendHistoryEntry={sendHistoryEntry} onNavigateBack={() => router.back()} />
    </>
  );
}

export default ModalScreen;
