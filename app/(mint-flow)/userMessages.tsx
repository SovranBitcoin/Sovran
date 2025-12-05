/**
 * @fileoverview Mint Flow User Messages Screen
 *
 * Part of the (mint-flow) modal group.
 * Displays a direct messaging interface for contacting mint operators.
 * Navigates horizontally within the mint flow modal.
 */

import React from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { UserMessagesScreen } from 'components/screens/UserMessagesScreen';

function ModalScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();

  // Handle back navigation within the flow
  const handleBack = () => {
    router.back();
  };

  return <UserMessagesScreen pubkey={pubkey} onBack={handleBack} />;
}

export default withSheetProvider(ModalScreen);
