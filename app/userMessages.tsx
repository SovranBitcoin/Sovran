/**
 * @fileoverview Standalone User Messages route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * For flow-based navigation with horizontal stack, use (mint-flow)/userMessages.
 */

import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { UserMessagesScreen } from 'components/screens/UserMessagesScreen';

function ModalScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();

  return <UserMessagesScreen pubkey={pubkey} />;
}

export default withSheetProvider(ModalScreen);
