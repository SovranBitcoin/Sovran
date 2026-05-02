/**
 * @fileoverview Send flow meltQuote route wrapper
 *
 * Part of the (send-flow) modal group - displays with back button.
 * The navigateToMeltPreview handler navigates here with a serialized
 * meltHistoryEntry; actions are handled by the screen-action system.
 *
 * Validates the `meltHistoryEntry` deep-link param at the route boundary
 * per AUDIT.md dim-5 (audit 23#F-002): the param is JSON-encoded and was
 * previously forwarded raw to a `JSON.parse(...)` cast.
 */

import React, { useCallback } from 'react';
import { router, Stack } from 'expo-router';
import { z } from 'zod';

import { MeltQuoteScreen } from '@/features/send';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { cashuLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  meltHistoryEntry: z.string().min(1).max(64_000).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'send-flow.meltQuote' });

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

  if (!params) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Lightning',
          headerBackButtonMenuEnabled: false,
        }}
      />
      <MeltQuoteScreen
        key={params.meltHistoryEntry}
        meltHistoryEntry={params.meltHistoryEntry}
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
