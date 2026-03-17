/**
 * @fileoverview Receive flow amount route wrapper
 *
 * Renders AmountSelector for the mintQuote destination.
 * No fiat toggle or offline optimization — just sat input.
 */

import React, { useCallback } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useExecutionState, useAmountActions } from 'coco-payment-ux/react';

import { AmountSelector } from '@/features/send';
import {
  usePaymentFlowMint,
  usePaymentFlowMachine,
} from '@/features/send/providers/PaymentFlowProvider';
import { MintSelector } from '@/features/wallet';
import { noMintSelectedPopup } from '@/shared/lib/popup';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

function ReceiveAmountRoute() {
  const params = useLocalSearchParams<{
    selectedMintUrl?: string;
    unit?: string;
  }>();

  const unit = params.unit || 'sat';

  const { keys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const selectedMints = useMintStore((state) => state.selectedMints);
  const storeMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const flowMint = usePaymentFlowMint();
  const selectedMint = flowMint ?? params.selectedMintUrl ?? storeMint;

  const walletContext = useWalletContextWithOverride(selectedMint);
  const machine = usePaymentFlowMachine({ walletContext, unit });
  const { isExecuting } = useExecutionState(machine);

  const amount = useAmountActions({
    mintUrl: selectedMint,
    proofAmounts: [],
    btcPrice: 0,
    offlineOptimization: false,
    unit,
  });

  const handleSubmit = useCallback(() => {
    if (!selectedMint) {
      noMintSelectedPopup();
      return;
    }
    void machine.enterAmount(amount.effectiveSatAmount, selectedMint, { destination: 'mintQuote' });
  }, [selectedMint, machine, amount.effectiveSatAmount]);

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Amount',
          headerTitleAlign: 'center',
          headerTitle: () => (
            <MintSelector
              unit={unit}
              selectedMintUrl={selectedMint}
              onMintSelected={handleMintSelected}
              onRequestMintList={handleRequestMintList}
            />
          ),
          headerTintColor: foreground,
        }}
      />
      <AmountSelector
        amount={amount}
        transactionType="receive"
        onSubmit={handleSubmit}
        loading={isExecuting}
      />
    </>
  );
}

export default ReceiveAmountRoute;
