/**
 * @fileoverview Mint Selection screen for Send Flow
 *
 * Thin UI screen — reads entry from params and delegates all actions
 * to useScreenActions('mintSelector'). The entry is pre-built by the
 * selectMint step handler with items, scope, and destination.
 *
 * Availability is derived from the entry: when destination is absent
 * (persist/management flow), getInfo and addMint actions are available.
 *
 * Validates the `mintSelectorEntry` deep-link param at the route boundary
 * per AUDIT.md dim-5 — the param is a JSON-encoded entry decoded by
 * `useScreenActions`.
 */

import React, { useEffect, useMemo } from 'react';
import { Stack, router } from 'expo-router';
import { z } from 'zod';

import { useScreenActions } from 'coco-payment-ux/react';
import type { MintListItem } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { usePaymentFlowMachine } from '@/features/send/providers/CocoPaymentUX';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintSelectorEntry: z.string().min(1).max(64_000).optional(),
});

function MintSelectRoute() {
  useLifecycleLogger('SendMintSelectRoute');
  const params = useRouteParams(ParamsSchema, { where: 'send-flow.mintSelect' });

  const walletContext = useWalletContext();
  usePaymentFlowMachine({ walletContext });

  const { entry, actions } = useScreenActions('mintSelector', params?.mintSelectorEntry);

  const items = useMemo<MintListItem[]>(
    () => (Array.isArray(entry?.items) ? (entry.items as MintListItem[]) : []),
    [entry?.items]
  );

  useEffect(() => {
    const available = items.filter((i) => i.status === 'available').length;
    const disabled = items.filter((i) => i.status === 'disabled').length;
    const withIcon = items.filter((i) => i.iconUrl).length;
    const withReputation = items.filter((i) => (i.contactReputation ?? 0) > 0).length;
    paymentLog.info('mint.selector.entry', {
      flow: 'send',
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

  if (!params) return null;

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

export default MintSelectRoute;
