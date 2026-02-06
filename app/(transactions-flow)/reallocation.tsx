/**
 * @fileoverview Transactions flow reallocation route wrapper
 *
 * Part of the (transactions-flow) modal group - displays with back button.
 */

import React from 'react';
import { useLocalSearchParams, Stack } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { ReallocationTransactionScreen } from 'components/screens/ReallocationTransactionScreen';

function ModalScreen() {
  const { groupId } = useLocalSearchParams<{ groupId?: string }>();

  return (
    <>
      <Stack.Screen options={{ title: 'Swap' }} />
      <ReallocationTransactionScreen groupId={groupId} />
    </>
  );
}

export default withSheetProvider(ModalScreen);
