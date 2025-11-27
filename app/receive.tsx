/**
 * @fileoverview Standalone receive route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ReceiveScreen } from 'components/screens/ReceiveScreen';

const EcashLightningReceiver = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();

  return (
    <>
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
