/**
 * @fileoverview Send flow amount route wrapper
 *
 * Renders AmountSelector with a mint header.
 * On submit, resumes payment resolver with amountEntered.
 * Supports Paste/Scan QR buttons for sendEcash destination.
 * Shows Offline/Online in headerRight when amount is composable from proofs.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import { composeSatoshis } from 'coco-payment-ux';
import type { AmountEntryConstraints } from 'coco-payment-ux';
import { useExecutionState } from 'coco-payment-ux/react';

import { AmountSelector, useProcessPaymentString } from '@/features/send';
import {
  usePaymentFlowMint,
  usePaymentFlowMintContext,
  usePaymentFlowMachine,
} from '@/features/send/providers/PaymentFlowProvider';
import { MintSelector } from '@/features/wallet';
import { noMintSelectedPopup, noClipboardAddressPopup } from '@/shared/lib/popup';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { usePaste } from '@/shared/hooks/usePaste';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { View } from '@/shared/ui/primitives/View/View';
import { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

function AmountRoute() {
  const params = useLocalSearchParams<{
    destination?: string;
    paymentRequest?: string;
    meltTarget?: string;
    selectedMintUrl?: string;
    unit?: string;
  }>();

  const destination = (params.destination || 'sendEcash') as AmountEntryConstraints['destination'];
  const unit = params.unit || 'sat';

  const { keys } = useNostrKeysContext();
  const foreground = useThemeColor('foreground');
  const selectedMints = useMintStore((state) => state.selectedMints);
  const storeMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const flowMint = usePaymentFlowMint();
  const selectedMint = flowMint ?? params.selectedMintUrl ?? storeMint;

  const walletContext = useWalletContextWithOverride(selectedMint);
  const isSendOperation = destination !== 'mintQuote';
  const machine = usePaymentFlowMachine({ walletContext, unit });
  const { isExecuting } = useExecutionState(machine);
  const mintContext = usePaymentFlowMintContext({ walletContext, unit });

  const { processPaymentString } = useProcessPaymentString({
    unit,
    selectedMint,
    isFocused: true,
  });

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
        destination,
      });
    },
    [selectedMint, destination, machine]
  );

  const { handlePaste: handlePastePress } = usePaste({
    onEmpty: noClipboardAddressPopup,
    onPaste: async (text) => {
      await processPaymentString({ data: text, type: 'paste' });
    },
  });

  const isEcashSend = destination === 'sendEcash';

  const [amount, setAmount] = useState(0);

  const canSendOffline = useMemo(() => {
    if (!isEcashSend || !selectedMint || amount <= 0) return null;
    const proofAmounts = walletContext.proofAmounts[selectedMint] ?? [];
    if (proofAmounts.length === 0) return null;
    return composeSatoshis(proofAmounts, amount).exactMatch;
  }, [isEcashSend, selectedMint, amount, walletContext.proofAmounts]);

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      void machine.changeMint(mintUrl);
    },
    [machine, destination]
  );

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  const extraButtons: ButtonHandlerProps['buttons'] = isEcashSend
    ? [
        {
          text: 'Paste',
          icon: 'lets-icons:copy',
          variant: 'secondary' as const,
          onPress: handlePastePress,
        },
        {
          text: 'Scan QR',
          icon: 'stash:qr-code',
          variant: 'secondary' as const,
          onPress: async () => {
            router.navigate({ pathname: '/camera', params: { unit } });
          },
        },
      ]
    : [];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Amount',
          headerTitleAlign: 'center',
          headerTitle: () => (
            <MintSelector
              unit={unit}
              trustedMints={mintContext?.trustedMints}
              selectedMintUrl={selectedMint}
              onMintSelected={handleMintSelected}
              onRequestMintList={handleRequestMintList}
            />
          ),
          headerTintColor: foreground,
          headerRight:
            canSendOffline !== null
              ? () => (
                  <IconSymbol
                    name={canSendOffline ? 'airplane' : 'wifi'}
                    size={18}
                    color={foreground}
                  />
                )
              : undefined,
        }}
      />
      <View style={{ flex: 1 }}>
        <AmountSelector
          unit={unit}
          transactionType={isSendOperation ? 'send' : 'receive'}
          onAmountSubmit={handleAmountSubmit}
          onAmountChange={isEcashSend ? setAmount : undefined}
          loading={isExecuting}
          extraButtons={extraButtons}
        />
      </View>
    </>
  );
}

export default AmountRoute;
