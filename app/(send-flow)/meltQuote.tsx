/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToMeltPreview handler navigates here with a serialized
 * meltHistoryEntry; actions are handled by the screen-action system.
 */

import React, { useCallback } from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { MeltQuoteScreen } from '@/features/send';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';

function ModalScreen() {
  const { meltHistoryEntry } = useLocalSearchParams<{
    meltHistoryEntry?: string;
  }>();

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      // Logged so we can tell — when investigating the NFC mint-pill bug —
      // whether the press ended up at changeMint (auto-change, the bug) or at
      // requestMintSelector (correct path) below.
      cashuLog.info('melt.mint.selected', { mintUrl, source: 'pill' });
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    cashuLog.info('melt.mint_list.requested', { source: 'pill' });
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          headerBackButtonMenuEnabled: false,
        }}
      />
      <MeltQuoteScreen
        key={meltHistoryEntry}
        meltHistoryEntry={meltHistoryEntry}
        onCancel={() => {
          router.dismissTo('/');
        }}
        onMintSelected={handleMintSelected}
        onRequestMintList={handleRequestMintList}
      />
    </>
  );
}

export default ModalScreen;
