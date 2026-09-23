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
import { useMintSelectorFrameLog } from '../hooks/useMintSelectorFrameLog';
import { useRefreshMintSelectorOnFocus } from '../hooks/useRefreshMintSelectorOnFocus';
import { useStickyMintSelectorItems } from '../hooks/useStickyMintSelectorItems';
import { useWalletContext } from '@/shared/providers/WalletContextProvider';
import { ScreenHeaderAction } from '@/shared/ui/composed/ScreenHeaderAction';
import { withGlassHeaderItems } from '@/navigation/headerItems';
import {
  paymentLog,
  useLifecycleLogger,
  useQueryResultLogger,
  useWhyDidRender,
} from '@/shared/lib/logger';

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
    // Thunk: five scans of the row list, and this effect re-runs on every
    // enrichment arrival. A release build pays for none of it.
    paymentLog.info('mint.selector.entry', () => ({
      flow,
      scope: entry?.scope,
      destination: entry?.destination,
      total: items.length,
      available: items.filter((i) => i.status === 'available').length,
      disabled: items.filter((i) => i.status === 'disabled').length,
      withIcon: items.filter((i) => i.iconUrl).length,
      withReputation: items.filter((i) => (i.contactReputation ?? 0) > 0).length,
      disabledReasons: items
        .filter((i) => i.reason)
        .map((i) => ({ mint: i.displayName, reason: i.reason?.code })),
    }));
  }, [flow, items, entry?.scope, entry?.destination]);

  // Row metadata composition — diagnoses "skeleton too long": all-cold means the
  // cache was empty (cold open), not a stuck enrichment.
  useEffect(() => {
    paymentLog.debug('mint.selector.rows', () => ({
      flow,
      cold: rows.filter((r) => r.metaState === 'cold').length,
      cached: rows.filter((r) => r.metaState === 'cached').length,
      live: rows.filter((r) => r.metaState === 'live').length,
      total: rows.length,
      allCold,
    }));
  }, [flow, rows, allCold]);

  useMintSelectorFrameLog({
    flow,
    scope: entry?.scope,
    destination: entry?.destination,
    step: execution.step,
    source: liveItems?.length
      ? 'live'
      : items.length === 0
        ? 'none'
        : items === entryItems
          ? 'entry'
          : 'previous-live',
    itemsStatus,
    rows,
  });

  // ── Instrumentation ───────────────────────────────────────────────────────
  // `mint.selector.entry` / `.rows` already describe WHAT arrived. These two
  // answer why this screen re-rendered while it arrived: the payment machine
  // pushes a new `execution` object on every step tick, so `render.why` is what
  // separates a real row change from machine churn.
  // Thunk: the three `rows.filter` scans below would otherwise run on every
  // render of a shipped build, where the logger is a no-op.
  useQueryResultLogger(() => ({
    source: 'MintSelectFlowScreen.rows',
    status: itemsStatus ?? 'unknown',
    count: rows.length,
    extra: {
      flow,
      step: execution.step,
      items: items.length,
      cold: rows.filter((r) => r.metaState === 'cold').length,
      cached: rows.filter((r) => r.metaState === 'cached').length,
      live: rows.filter((r) => r.metaState === 'live').length,
      allCold,
      liveItems: liveItems?.length ?? 0,
      entryItems: entryItems?.length ?? 0,
    },
  }));
  useWhyDidRender(
    'MintSelectFlowScreen',
    () => ({
      entry,
      actions,
      execution,
      liveSelectMint,
      items,
      rows,
      itemsStatus,
      trackedTrustedMintUrls,
      walletContext,
    }),
    paymentLog
  );

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
