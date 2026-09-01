/**
 * @fileoverview Mint Selection screen shared by the send and receive flows.
 *
 * Thin UI screen — reads entry from params and delegates all actions
 * to useScreenActions('mintSelector'). The entry is pre-built by the
 * selectMint step handler with items, scope, and destination.
 *
 * Availability is derived from the entry: when destination is absent
 * (persist/management flow), getInfo and addMint actions are available.
 *
 * `flow` is a data tag (logs + focus-refresh) — both flows render the same
 * screen; the only scope-specific behavior is the NPC chrome collapse, and
 * `npc` is a receive-only scope so it is inert on send.
 */

import { useCallback, useEffect } from 'react';
import { Stack } from 'expo-router';

import {
  useColadaTrustedMintUrls,
  useExecutionState,
  useScreenActions,
  usePaymentFlowMachine,
} from 'wallet/react';
import type { MintListItem, StepDataMap } from 'wallet';

import { MintListScreen } from './MintListScreen';
import { useMintRowsWithCache } from '../hooks/useMintRowsWithCache';
import { useRefreshMintSelectorOnFocus } from '../hooks/useRefreshMintSelectorOnFocus';
import { useStickyMintSelectorItems } from '../hooks/useStickyMintSelectorItems';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import { paymentLog, useLifecycleLogger } from '@/shared/lib/logger';

type MintSelectFlow = 'send' | 'receive';

interface MintSelectFlowScreenProps {
  flow: MintSelectFlow;
  /** JSON-encoded mint-selector entry, already validated at the route boundary. */
  mintSelectorEntry: string | undefined;
}

export function MintSelectFlowScreen({ flow, mintSelectorEntry }: MintSelectFlowScreenProps) {
  useLifecycleLogger(flow === 'send' ? 'SendMintSelectRoute' : 'ReceiveMintSelectRoute');

  const walletContext = useWalletContext();
  const trackedTrustedMintUrls = useColadaTrustedMintUrls();
  const machine = usePaymentFlowMachine({ walletContext });
  const execution = useExecutionState(machine);

  const { entry, actions } = useScreenActions('mintSelector', mintSelectorEntry);
  const liveSelectMint =
    execution.step === 'selectMint' ? (execution.details as StepDataMap['selectMint']) : null;
  const candidateMintUrls = liveSelectMint?.candidates.map((candidate) => candidate.mintUrl) ?? [];
  // Optional chain resolved before the callback: React Compiler cannot validate
  // a dependency that is itself an optional chain, and refuses to preserve the
  // memo when it sees one.
  const selectMintScope = liveSelectMint?.scope;
  const refreshMintSelector = useCallback(
    () => machine.requestMintSelector(selectMintScope ? { scope: selectMintScope } : undefined),
    [selectMintScope, machine]
  );

  useRefreshMintSelectorOnFocus({
    enabled: actions.addMint.available && liveSelectMint !== null,
    flow,
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
    paymentLog.info('mint.selector.entry', {
      flow,
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
  }, [flow, items, entry?.scope, entry?.destination]);

  // Row metadata composition — diagnoses "skeleton too long": all-cold means the
  // cache was empty (cold open), not a stuck enrichment.
  useEffect(() => {
    paymentLog.debug('mint.selector.rows', {
      flow,
      cold: rows.filter((r) => r.metaState === 'cold').length,
      cached: rows.filter((r) => r.metaState === 'cached').length,
      live: rows.filter((r) => r.metaState === 'live').length,
      total: rows.length,
      allCold,
    });
  }, [flow, rows, allCold]);

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
