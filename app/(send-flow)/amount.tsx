/**
 * @fileoverview Send flow amount route wrapper
 *
 * Renders AmountSelector with a mint header. All amount input state,
 * fiat toggle, offline composition, and display values are owned by
 * the AmountActionManager via useAmountActions.
 */

import React, { useCallback } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';

import type { AmountEntryConstraints } from 'coco-payment-ux';
import { useExecutionState, useAmountActions } from 'coco-payment-ux/react';

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
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { usePaste } from '@/shared/hooks/usePaste';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { View } from '@/shared/ui/primitives/View/View';
import { ButtonHandlerProps } from '@/shared/ui/composed/ButtonHandler';

const FIAT_SYMBOLS: Record<string, string> = {
  usd: '$',
  eur: '€',
  gbp: '£',
};

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
  const { isOffline } = useOfflineStatus();
  const btcPrice = useBtcPrice() ?? 0;
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);

  const { processPaymentString } = useProcessPaymentString({
    unit,
    selectedMint,
    isFocused: true,
  });

  const isEcashSend = destination === 'sendEcash';

  // Amount actions: manages rawInput, inputMode, canSendOffline,
  // fiat-window auto-optimization, display values — all in the manager.
  const amount = useAmountActions({
    mintUrl: selectedMint,
    proofAmounts: selectedMint ? (walletContext.proofAmounts[selectedMint] ?? []) : [],
    btcPrice,
    offlineOptimization: isEcashSend,
    unit,
    fiatCurrency: isSendOperation ? displayCurrency : undefined,
    fiatSymbol: isSendOperation ? FIAT_SYMBOLS[displayCurrency] : undefined,
  });

  const handleSubmit = useCallback(() => {
    const mintUrl = selectedMint;
    if (!mintUrl) {
      noMintSelectedPopup();
      return;
    }
    void machine.enterAmount(amount.effectiveSatAmount, mintUrl, {
      destination,
      offline: isOffline,
    });
  }, [selectedMint, destination, machine, amount.effectiveSatAmount, isOffline]);

  const { handlePaste: handlePastePress } = usePaste({
    onEmpty: noClipboardAddressPopup,
    onPaste: async (text) => {
      await processPaymentString({ data: text, type: 'paste' });
    },
  });

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      void machine.changeMint(mintUrl);
    },
    [machine]
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
            amount.canSendOffline !== null
              ? () => (
                  <IconSymbol
                    name={amount.canSendOffline ? 'airplane' : 'wifi'}
                    size={18}
                    color={foreground}
                  />
                )
              : undefined,
        }}
      />
      <View style={{ flex: 1 }}>
        <AmountSelector
          amount={amount}
          transactionType={isSendOperation ? 'send' : 'receive'}
          onSubmit={handleSubmit}
          loading={isExecuting}
          extraButtons={extraButtons}
        />
      </View>
    </>
  );
}

export default AmountRoute;
