/**
 * Shared send/receive amount route shell: mint header, amount entry screen actions, AmountSelector.
 *
 * Follows the same pattern as MeltQuoteScreen, SendTokenScreen, etc:
 * receives a single serialized entry from the machine's step handler,
 * passes it to useScreenActions, and renders UI.
 */

import { useCallback } from 'react';
import { Stack } from 'expo-router';

import { useExecutionState, useScreenActions } from 'coco-payment-ux/react';

import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { MintSelector } from '@/features/wallet';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { View } from '@/shared/ui/primitives/View/View';
import { log, useLifecycleLogger, Screen } from '@/shared/lib/logger';

import { AmountSelector } from './AmountSelector';

interface AmountFlowScreenProps {
  amountEntry?: string;
}

export function AmountFlowScreen({ amountEntry }: AmountFlowScreenProps) {
  useLifecycleLogger('AmountFlowScreen');
  const foreground = useThemeColor('foreground');
  const background = useThemeColor('background');

  const { entry, error, actions, suggestions, mintUrl } = useScreenActions(
    'amountEntry',
    amountEntry
  );
  if (error) {
    log.warn('send.amount_flow.error', { error });
  }

  const walletContext = useWalletContextWithOverride();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { isExecuting } = useExecutionState(machine);

  const handleMintSelected = useCallback(
    (mintUrl: string) => {
      log.info('send.amount_flow.mint_selected', { mintUrl });
      void machine.changeMint(mintUrl);
    },
    [machine]
  );

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  const canSendOffline = typeof entry?.canSendOffline === 'boolean' ? entry.canSendOffline : null;

  if (error) {
    return null;
  }

  if (!entry) {
    return <View style={{ flex: 1, backgroundColor: background }} />;
  }

  const isSendOperation = entry.destination !== 'mintQuote';

  return (
    <Screen name="AmountFlowScreen">
      <Stack.Screen
        options={{
          title: 'Select Amount',
          headerTitleAlign: 'center',
          headerTitle: () => (
            <MintSelector
              selectedMintUrl={mintUrl}
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
          entry={entry}
          actions={actions}
          suggestions={suggestions}
          transactionType={isSendOperation ? 'send' : 'receive'}
          machineBusy={isExecuting}
        />
      </View>
    </Screen>
  );
}
