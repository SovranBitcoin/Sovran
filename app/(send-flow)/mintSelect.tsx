/**
 * @fileoverview Mint Selection screen for Send Flow
 *
 * Entry point when user has no balance on current mint.
 * Shows list of mints with balances to select from.
 * After selection, navigates horizontally to currency screen.
 */

import React from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { MintListScreen } from 'components/screens/MintListScreen';

function MintSelectRoute() {
  const params = useLocalSearchParams<{ unit?: string; to?: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Select Mint' }} />
      <MintListScreen
        requireBalance={true}
        showDetailsButton={false}
        currencyLabel="Send payment in"
        mintsLabel="Send from"
        closeButtonLabel="Cancel"
        onMintSelect={(mint) => {
          router.navigate({
            pathname: '/currency',
            params: {
              to: params.to || 'sendToken',
              unit: mint.unit.toLowerCase(),
            },
          });
        }}
        onClose={() => router.back()}
      />
    </>
  );
}

export default withSheetProvider(MintSelectRoute);
