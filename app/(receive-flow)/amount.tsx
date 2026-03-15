/**
 * @fileoverview Receive flow amount route wrapper
 *
 * Renders AmountSelector for the mintQuote destination.
 * On submit, resumes payment resolver with amountEntered and mintQuote destination.
 */

import React, { useCallback } from 'react';
import { Stack, useLocalSearchParams } from 'expo-router';

import { useExecutionState } from 'coco-payment-ux/react';

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
    destination?: string;
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

  const handleAmountSubmit = useCallback(
    (amount: number) => {
      const mintUrl = selectedMint;
      if (!mintUrl) {
        noMintSelectedPopup();
        return;
      }
      void machine.send({
        type: 'AMOUNT_ENTERED',
        amount,
        mintUrl,
        destination: 'mintQuote',
      });
    },
    [selectedMint, machine]
  );

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
        unit={unit}
        transactionType="receive"
        onAmountSubmit={handleAmountSubmit}
        loading={isExecuting}
      />
    </>
  );
}

export default ReceiveAmountRoute;
