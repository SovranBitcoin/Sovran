/**
 * @fileoverview Standalone User Messages route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * For flow-based navigation with horizontal stack, use (mint-flow)/userMessages.
 */

import React, { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { UserMessagesScreen } from '@/features/user';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { ROUTSTR_PUBKEY } from '@/shared/lib/constants';

function ModalScreen() {
  const { pubkey, model } = useLocalSearchParams<{ pubkey: string; model?: string }>();
  const { setSelectedModel } = useRoutstrStore();

  // If a model is passed and this is routstr, set it as selected
  useEffect(() => {
    if (model && pubkey === ROUTSTR_PUBKEY) {
      setSelectedModel(model);
    }
  }, [model, pubkey, setSelectedModel]);

  return <UserMessagesScreen pubkey={pubkey} />;
}

export default withSheetProvider(ModalScreen);
