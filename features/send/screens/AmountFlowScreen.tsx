/**
 * Shared send/receive amount route shell: mint header, amount entry screen actions, AmountSelector.
 *
 * Follows the same pattern as MeltQuoteScreen, SendTokenScreen, etc:
 * receives a single serialized entry from the machine's step handler,
 * passes it to useScreenActions, and renders UI.
 */

import { useCallback, useEffect } from 'react';
import { Stack } from 'expo-router';

import { useExecutionState, useScreenActions } from 'coco-payment-ux/react';

import { usePaymentFlowMachine } from 'coco-payment-ux/react';
import { MintSelector } from '@/features/wallet';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { IconSymbol } from '@/shared/ui/primitives/icon-symbol';
import { View } from '@/shared/ui/primitives/View/View';
import { paymentLog, useLifecycleLogger, Log } from '@/shared/lib/logger';

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

  const walletContext = useWalletContextWithOverride();
  const machine = usePaymentFlowMachine({ walletContext, unit: 'sat' });
  const { isExecuting } = useExecutionState(machine);

  const handleRequestMintList = useCallback(() => {
    void machine.requestMintSelector();
  }, [machine]);

  const canSendOffline = typeof entry?.canSendOffline === 'boolean' ? entry.canSendOffline : null;

  useEffect(() => {
    if (error) paymentLog.warn('send.amount_flow.error', { error });
  }, [error]);

  if (error) {
    return null;
  }

  if (!entry) {
    return <View style={{ flex: 1, backgroundColor: background }} />;
  }

  const isSendOperation = entry.destination !== 'mintQuote';

  return (
    <Log name="AmountFlowScreen">
      <Stack.Screen
        options={{
          title: 'Select Amount',
          headerTitleAlign: 'center',
          headerTitle: () => (
            <MintSelector selectedMintUrl={mintUrl} onRequestMintList={handleRequestMintList} />
          ),
          headerTintColor: foreground,
          headerRight:
            isSendOperation && mintUrl
              ? () => (
                  <IconSymbol
                    name={canSendOffline === true ? 'airplane' : 'wifi'}
                    size={18}
                    color={foreground}
                    style={{ opacity: canSendOffline === null ? 0.3 : 1 }}
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
    </Log>
  );
}
