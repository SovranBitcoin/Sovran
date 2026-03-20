/**
 * @fileoverview Mint Selection screen for Receive Flow
 *
 * Shows list of mints to select from for receiving.
 * Items are pre-built by the handler and passed via the mintItems param.
 * All selections go through machine.changeMint() which handles both
 * initial selection and mid-flow mint swaps.
 */

import React, { useCallback } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { useExecutionState } from 'coco-payment-ux/react';
import type { MintListItem } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function ReceiveMintSelectRoute() {
  const params = useLocalSearchParams<{
    unit?: string;
    mintItems?: string;
    destination?: string;
    mintScope?: 'npc' | 'selected';
  }>();

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({
    walletContext,
    unit: params.unit ?? 'sat',
  });
  const { isExecuting } = useExecutionState(machine);

  const items: MintListItem[] = params.mintItems ? JSON.parse(params.mintItems) : [];

  const handleMintNavigation = useCallback(
    (item: MintListItem) => {
      void machine.changeMint(item.mintUrl, { scope: params.mintScope ?? 'selected' });
    },
    [machine, params.mintScope]
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Select Mint' }} />
      <MintListScreen
        items={items}
        isExecuting={isExecuting}
        showDetailsButton={false}
        closeButtonLabel="Cancel"
        onMintSelect={handleMintNavigation}
        onClose={() => router.back()}
      />
    </>
  );
}

export default ReceiveMintSelectRoute;
