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
import { Stack, router, useLocalSearchParams } from 'expo-router';

import { useScreenActions } from 'coco-payment-ux/react';
import type { MintListItem } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { log, useLifecycleLogger } from '@/shared/lib/logger';

function ReceiveMintSelectRoute() {
  useLifecycleLogger('ReceiveMintSelectRoute');
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
      disabledReasons: items
        .filter((i) => i.reason)
        .map((i) => ({ mint: i.displayName, reason: i.reason?.code })),
    });
  }, [items, entry?.scope, entry?.destination]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerRight: () =>
            actions.addMint.available ? (
              <ScreenHeaderAction
                icon="fluent:add-24-filled"
                onPress={() => actions.addMint.execute()}
              />
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
            ? (url) =>
                actions.getInfo.execute({
                  mintUrl: url,
                  item: items.find((i) => i.mintUrl === url),
                })
            : undefined
        }
        onClose={() => router.back()}
      />
    </>
  );
}

export default ReceiveMintSelectRoute;
