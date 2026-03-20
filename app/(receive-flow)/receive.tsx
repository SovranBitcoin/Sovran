/**
 * @fileoverview Receive flow receive route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 * ReceiveScreen owns navigation and machine logic.
 */

import React from 'react';
import { useLocalSearchParams, Stack } from 'expo-router';

import { ReceiveScreen } from '@/features/receive';

const EcashLightningReceiver = () => {
  const { receiveEntry, unit } = useLocalSearchParams<{
    receiveEntry?: string;
    unit?: string;
  }>();

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <ReceiveScreen receiveEntry={receiveEntry} unit={unit || 'sat'} />
    </>
  );
};

export default EcashLightningReceiver;
