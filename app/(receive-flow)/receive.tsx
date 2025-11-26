/**
 * @fileoverview Receive flow receive route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ReceiveScreen, getFormattedReceiveTitle } from 'components/screens/ReceiveScreen';

const EcashLightningReceiver = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const formattedTitle = getFormattedReceiveTitle(unit || 'sat');

  return (
    <>
      <Stack.Screen options={{ headerTitle: formattedTitle }} />
      <ReceiveScreen
        unit={unit || 'sat'}
        onReceiveToken={(receiveHistoryEntry) => {
          // Navigate within the receive-flow modal (horizontal push)
          router.push({
            pathname: '/(receive-flow)/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        }}
        onCamera={(unit) => {
          // Navigate within the receive-flow modal (horizontal push)
          router.push({
            pathname: '/(receive-flow)/camera',
            params: { unit },
          });
        }}
        onFixedAmount={(unit) => {
          // Navigate within the same modal stack (horizontal push)
          router.push({
            pathname: '/(receive-flow)/currency',
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
