/**
 * @fileoverview Mint Selection screen for Send Flow
 *
 * Shows list of mints with balances to select from.
 * Items are pre-built by the handler and passed via the mintItems param.
 * All selections go through machine.changeMint() which handles both
 * initial selection and mid-flow mint swaps.
 */

import React, { useCallback } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { useExecutionState } from 'coco-payment-ux/react';
import type { MintListItem } from 'coco-payment-ux';

import { debugLog } from '@/shared/lib/debugLog';
import { MintListScreen } from '@/features/mint';
import { usePaymentFlowMachine } from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';

function MintSelectRoute() {
  const params = useLocalSearchParams<{
    unit?: string;
    destination?: string;
    mintItems?: string;
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
      debugLog({
        location: 'SendMintSelect.handleMintSelect',
        message: 'user selected mint from list (send flow)',
        phase: 'before',
        data: {
          mintUrl: item.mintUrl,
          destination: params.destination ?? null,
          isExecutingAtTap: isExecuting,
          machineStep: machine.getStep(),
        },
      });
      void machine.changeMint(item.mintUrl);
    },
    [machine, params.destination, isExecuting]
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

export default MintSelectRoute;
