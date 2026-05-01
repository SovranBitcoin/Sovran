/**
 * @fileoverview Standalone User Messages route wrapper
 *
 * This is the standalone version used for direct navigation and deep linking.
 * For flow-based navigation with horizontal stack, use (mint-flow)/userMessages.
 */

import React, { useEffect } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { UserMessagesScreen } from '@/features/user';
import { ROUTSTR_PUBKEY } from '@/shared/lib/constants';

function ModalScreen() {
  const { pubkey } = useLocalSearchParams<{ pubkey: string }>();

  // Legacy deep-link: opening the AI agent as a DM now redirects to the AI
  // tab — the standalone DM screen no longer hosts the AI experience. The
  // AI tab is tier-only and always boots into Auto, so a `?model=` param
  // can no longer preselect a specific model.
  useEffect(() => {
    if (pubkey !== ROUTSTR_PUBKEY) return;
    router.replace('/(drawer)/(tabs)/ai');
  }, [pubkey]);

  if (pubkey === ROUTSTR_PUBKEY) return null;

  return <UserMessagesScreen pubkey={pubkey} />;
}

export default ModalScreen;
