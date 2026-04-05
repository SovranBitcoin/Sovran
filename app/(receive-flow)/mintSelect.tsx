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

import React, { useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { useScreenActions } from 'coco-payment-ux/react';
import type { MintListItem } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import Icon from 'assets/icons';

function ReceiveMintSelectRoute() {
  useLifecycleLogger('ReceiveMintSelectRoute');
  const foreground = useThemeColor('foreground');
  const params = useLocalSearchParams<{ mintSelectorEntry?: string }>();

  const walletContext = useWalletContext();
  usePaymentFlowMachine({ walletContext });

  const { entry, actions } = useScreenActions('mintSelector', params.mintSelectorEntry);

  const items: MintListItem[] = Array.isArray(entry?.items) ? (entry.items as MintListItem[]) : [];

  useEffect(() => {
    const available = items.filter((i) => i.status === 'available').length;
    const disabled = items.filter((i) => i.status === 'disabled').length;
    const withIcon = items.filter((i) => i.iconUrl).length;
    const withReputation = items.filter((i) => (i.contactReputation ?? 0) > 0).length;
    log.info('mint.selector.entry', {
      flow: 'receive',
      scope: entry?.scope,
      destination: entry?.destination,
      total: items.length,
      available,
      disabled,
      withIcon,
      withReputation,
      disabledReasons: items.filter((i) => i.reason).map((i) => ({ mint: i.displayName, reason: i.reason?.code })),
    });
  }, [items, entry?.scope, entry?.destination]);

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
