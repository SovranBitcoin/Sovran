/**
 * @fileoverview User Flow Messages Screen
 *
 * Part of the (user-flow) modal group.
 * Displays a direct messaging interface for contacting users.
 * Navigates horizontally within the user flow modal.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { UserMessagesScreen } from 'components/screens/UserMessagesScreen';

function ModalScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();

  return <UserMessagesScreen pubkey={pubkey} onBack={() => router.back()} isFlowContext />;
}

export default withSheetProvider(ModalScreen);
