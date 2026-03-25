/**
 * @fileoverview Mint Selection screen for Receive Flow
 *
 * Thin UI screen — reads entry from params and delegates all actions
 * to useScreenActions('mintSelector'). The entry is pre-built by the
 * selectMint step handler with items, scope, and destination.
 *
 * Availability is derived from the entry: when destination is absent
 * (persist/management flow), getInfo and addMint actions are available.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { useScreenActions } from 'coco-payment-ux/react';
import type { MintListItem } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import Icon from 'assets/icons';

function ReceiveMintSelectRoute() {
  const foreground = useThemeColor('foreground');
  const params = useLocalSearchParams<{ mintSelectorEntry?: string }>();

  const walletContext = useWalletContext();
  usePaymentFlowMachine({ walletContext });

  const { entry, actions } = useScreenActions('mintSelector', params.mintSelectorEntry);

  const items: MintListItem[] = Array.isArray(entry?.items) ? (entry.items as MintListItem[]) : [];

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerRight: () =>
            actions.addMint.available ? (
              <TouchableOpacity style={{ padding: 8 }} onPress={() => actions.addMint.execute()}>
                <Icon name="fluent:add-24-filled" size={24} color={foreground} />
              </TouchableOpacity>
            ) : null,
        }}
      />
      <MintListScreen
        items={items}
        showDetailsButton={actions.getInfo.available}
        closeButtonLabel="Cancel"
        onMintSelect={(item) => actions.select.execute({ mintUrl: item.mintUrl })}
        onInspectMint={
          actions.getInfo.available
            ? (url) => actions.getInfo.execute({ mintUrl: url })
            : undefined
        }
        onClose={() => router.back()}
      />
    </>
  );
}

export default ReceiveMintSelectRoute;
