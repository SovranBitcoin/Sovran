/**
 * @fileoverview Receive flow receive route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ReceiveScreen, getFormattedReceiveTitle } from '@/features/receive';

const EcashLightningReceiver = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const formattedTitle = getFormattedReceiveTitle(unit || 'sat');

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
      />
    </>
  );
};

export default withSheetProvider(EcashLightningReceiver);
