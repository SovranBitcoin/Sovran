/**
 * @fileoverview Mint Selection screen for Receive Flow
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

import { useExecutionState, useScreenActions, usePaymentFlowMachine } from 'coco-payment-ux/react';
import type { MintListItem, StepDataMap } from 'coco-payment-ux';

import { MintListScreen } from '@/features/mint';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintSelectorEntry: z.string().min(1).max(64_000).optional(),
});

function ReceiveMintSelectRoute() {
  useLifecycleLogger('ReceiveMintSelectRoute');
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.mintSelect' });

  const walletContext = useWalletContext();
  const machine = usePaymentFlowMachine({ walletContext });
  const execution = useExecutionState(machine);

  const { entry, actions } = useScreenActions('mintSelector', params?.mintSelectorEntry);
  const liveSelectMint =
    execution.step === 'selectMint' ? (execution.details as StepDataMap['selectMint']) : null;

  const items = useMemo<MintListItem[]>(
    () =>
      Array.isArray(liveSelectMint?.mintListItems)
        ? liveSelectMint.mintListItems
        : Array.isArray(entry?.items)
          ? (entry.items as MintListItem[])
          : [],
    [entry?.items, liveSelectMint?.mintListItems]
  );

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

  if (!params) return null;

  // NPC-scoped selection picks the receive mint for the npub.cash flow; the
  // user is choosing among existing trusted mints (gated to NUT-17), not
  // adding new ones or inspecting trust details, so collapse the chrome.
  const isNpcScope = entry?.scope === 'npc';

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Select Mint',
          headerRight: () =>
            !isNpcScope && actions.addMint.available ? (
              <ScreenHeaderAction
                icon="fluent:add-24-filled"
                onPress={() => actions.addMint.execute()}
              />
            ) : null,
        }}
      />
      <MintListScreen
        items={items}
        showDetailsButton={!isNpcScope && actions.getInfo.available}
        closeButtonLabel="Cancel"
        onMintSelect={(item) => actions.select.execute({ mintUrl: item.mintUrl })}
        onInspectMint={
          !isNpcScope && actions.getInfo.available
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
