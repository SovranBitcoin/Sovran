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

import { useCallback, useEffect } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';

import {
  useColadaTrustedMintUrls,
  useExecutionState,
  useScreenActions,
  usePaymentFlowMachine,
} from 'wallet/react';
import type { MintListItem, StepDataMap } from 'wallet';

import {
  MintListScreen,
  useMintRowsWithCache,
  useRefreshMintSelectorOnFocus,
  useStickyMintSelectorItems,
} from '@/features/mint';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { log, useLifecycleLogger } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';

const ParamsSchema = z.object({
  mintSelectorEntry: z.string().min(1).max(64_000).optional(),
});

function ReceiveMintSelectRoute() {
  useLifecycleLogger('ReceiveMintSelectRoute');
  const params = useRouteParams(ParamsSchema, { where: 'receive-flow.mintSelect' });

  const walletContext = useWalletContext();
  const trackedTrustedMintUrls = useColadaTrustedMintUrls();
  const machine = usePaymentFlowMachine({ walletContext });
  const execution = useExecutionState(machine);

  const { entry, actions } = useScreenActions('mintSelector', params?.mintSelectorEntry);
  const liveSelectMint =
    execution.step === 'selectMint' ? (execution.details as StepDataMap['selectMint']) : null;
  const candidateMintUrls = liveSelectMint?.candidates.map((candidate) => candidate.mintUrl) ?? [];
  const refreshMintSelector = useCallback(
    () =>
      machine.requestMintSelector(
        liveSelectMint?.scope ? { scope: liveSelectMint.scope } : undefined
      ),
    [liveSelectMint?.scope, machine]
  );

  useRefreshMintSelectorOnFocus({
    enabled: actions.addMint.available && liveSelectMint !== null,
    flow: 'receive',
    trustedMintUrls: trackedTrustedMintUrls ?? walletContext.trustedMintUrls,
    candidateMintUrls,
    refresh: refreshMintSelector,
  });

  const liveItems = Array.isArray(liveSelectMint?.mintListItems)
    ? liveSelectMint.mintListItems
    : null;
  const entryItems = Array.isArray(entry?.items) ? (entry.items as MintListItem[]) : null;
  const items = useStickyMintSelectorItems(liveItems, entryItems);
  // The machine emits un-enriched fallback rows first (raw url, no icon/scores)
  // then fills them in — `mintListItemsStatus` flips to 'ready' when done. The
  // cache overlay paints each row from `mintMetadataStore` immediately, so a
  // warm open shows real name/icon/scores on the first frame and animates to
  // fresh values; only genuinely-cold rows fall back to a skeleton.
  const itemsStatus =
    liveSelectMint?.mintListItemsStatus ??
    (entry?.mintListItemsStatus as 'loading' | 'ready' | 'failed' | undefined);
  const { rows, allCold } = useMintRowsWithCache({ baseItems: items, itemsStatus });

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

  // Row metadata composition — diagnoses "skeleton too long": all-cold means the
  // cache was empty (cold open), not a stuck enrichment.
  useEffect(() => {
    log.debug('mint.selector.rows', {
      flow: 'receive',
      cold: rows.filter((r) => r.metaState === 'cold').length,
      cached: rows.filter((r) => r.metaState === 'cached').length,
      live: rows.filter((r) => r.metaState === 'live').length,
      total: rows.length,
      allCold,
    });
  }, [rows, allCold]);

  if (!params) return null;

  // NPC-scoped selection picks the receive mint for the npub.cash flow; the
  // user is choosing among existing trusted mints (gated to NUT-17), not
  // adding new ones or inspecting trust details, so collapse the chrome.
  const isNpcScope = entry?.scope === 'npc';

  return (
    <>
      <Stack.Screen
        options={withGlassHeaderItems({
          title: 'Select Mint',
          headerRight: () =>
            !isNpcScope && actions.addMint.available ? (
              <ScreenHeaderAction
                testID="mint-select-add"
                accessibilityLabel="Add mint"
                icon="fluent:add-24-filled"
                onPress={() => actions.addMint.execute()}
              />
            ) : null,
        })}
      />
      <MintListScreen
        items={rows}
        loading={allCold}
        showDetailsButton={!isNpcScope && actions.getInfo.available}
        closeButtonLabel="Cancel"
        onMintSelect={(item) => actions.select.execute({ mintUrl: item.mintUrl })}
        onInspectMint={
          !isNpcScope && actions.getInfo.available
            ? (url) =>
                actions.getInfo.execute({
                  mintUrl: url,
                  item: rows.find((i) => i.mintUrl === url),
                })
            : undefined
        }
        onClose={() => actions.cancel.execute()}
      />
    </>
  );
}

export default ReceiveMintSelectRoute;
