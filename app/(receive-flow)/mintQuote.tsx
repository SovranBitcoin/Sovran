/**
 * @fileoverview Receive flow mintQuote route wrapper
 *
 * Displays a mint quote that was created before navigation.
 * The mintHistoryEntry param contains the full MintHistoryEntry as JSON.
 * Wires up the resolver so MintSelector can trigger changeMint(),
 * which re-runs the createMintQuote handler with the new mint.
 *
 * Validates deep-link params at the route boundary per AUDIT.md dim-5
 * (audit 23#F-002): unguarded `JSON.parse(...)` was the crash +
 * invoice-spoofing surface.
 */

import React, { useCallback } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';

import { MintQuoteScreen } from '@/features/receive';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

function ModalScreen() {
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.mintQuote' });

  const unit = params?.unit ?? 'sat';

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit });

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  if (!params) return null;

  return (
    <>
      <Stack.Screen options={{ headerTitle: 'Receive' }} />
      <MintQuoteScreen
        key={params.mintHistoryEntry}
        mintHistoryEntry={params.mintHistoryEntry}
        onMintSelected={handleMintSelected}
        onRequestMintList={handleRequestMintList}
      />
    </>
  );
}

export default ModalScreen;
