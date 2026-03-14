/**
 * @fileoverview Receive flow receive route wrapper
 *
 * Part of the (receive-flow) modal group - displays with back button.
 *
 * "Fixed Amount" goes through the machine so flow state is established before
 * the Amount screen mounts. Paste goes through the machine to handle any input.
 */

import React from 'react';
import { useLocalSearchParams, router, Stack } from 'expo-router';

import { ReceiveScreen, getFormattedReceiveTitle } from '@/features/receive';
import { useProcessPaymentString } from '@/features/send';
import { usePaymentFlowMachine } from '@/features/send/providers/PaymentFlowProvider';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';

const EcashLightningReceiver = () => {
  const { unit } = useLocalSearchParams<{ unit: string }>();
  const formattedTitle = getFormattedReceiveTitle(unit || 'sat');

  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext, unit: unit || 'sat' });

  const { processPaymentString } = useProcessPaymentString({
    unit: unit || 'sat',
    selectedMint,
    isFocused: true,
  });

  return (
    <>
      <Stack.Screen options={{ headerTitle: formattedTitle }} />
      <ReceiveScreen
        unit={unit || 'sat'}
        onReceiveToken={(receiveHistoryEntry) => {
          router.navigate({
            pathname: '/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        }}
        onCamera={(unit) => {
          router.navigate({
            pathname: '/camera',
            params: { unit },
          });
        }}
        onFixedAmount={() => {
          void machine.startReceiveLightning();
        }}
        onPaste={async (text) => {
          await processPaymentString({ data: text, type: 'paste' });
        }}
      />
    </>
  );
};

export default EcashLightningReceiver;
