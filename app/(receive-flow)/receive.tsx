/**
 * @fileoverview Receive flow receive route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { ReceiveScreen, getFormattedReceiveTitle } from '@/features/receive';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';

const EcashLightningReceiver = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const formattedTitle = getFormattedReceiveTitle(unit || 'sat');

  const { scan } = usePaymentMachine();

  const processPaymentString = useCallback(
    async (scanning: { data: string; type?: string }) => {
      const source =
        scanning.type === 'paste' || scanning.type === 'deeplink' ? scanning.type : 'qr';
      return scan(scanning.data, source);
    },
    [scan]
  );

  return (
    <>
      <Stack.Screen options={{ headerTitle: formattedTitle }} />
      <ReceiveScreen
        unit={unit || 'sat'}
        onReceiveToken={(receiveHistoryEntry) => {
          router.navigate({
            pathname: '/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        }}
        onCamera={(unit) => {
          router.navigate({
            pathname: '/camera',
            params: { unit },
          });
        }}
        onFixedAmount={(unit) => {
          router.navigate({
            pathname: '/currency',
            params: {
              to: 'mintQuote',
              unit,
            },
          });
        }}
        processPaymentStringFn={processPaymentString}
      />
    </>
  );
};

export default EcashLightningReceiver;
