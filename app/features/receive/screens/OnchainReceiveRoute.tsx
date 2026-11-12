/**
 * @fileoverview Canonical Onchain receive route shell.
 *
 * The underlying Cashu operation is still a mint quote, so this route keeps
 * the `useScreenActions('mintQuote', ...)` contract and renders the onchain
 * rail-specific screen.
 */

import { useEffect, useMemo } from 'react';
import { Stack } from 'expo-router';
import { useScreenActions, type BoundAction } from 'wallet/react';

import { useReceiveRailRoute } from '@/features/receive/hooks/useReceiveRailRoute';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { paymentLog } from '@/shared/lib/logger';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';

import { OnchainReceiveScreen, type OnchainReceiveEntry } from './OnchainReceiveScreen';

interface OnchainReceiveRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.onchainReceive'`. */
  where: string;
  /** The receive flow's mint pill swaps mints; omitted for read-only re-entries. */
  editableMint?: boolean;
}

export function OnchainReceiveRoute({ where, editableMint = false }: OnchainReceiveRouteProps) {
  const { params, onRequestMintList, flowBinding } = useReceiveRailRoute(
    'onchain',
    where,
    editableMint
  );
  if (!params) return flowBinding;
  paymentLog.info('receive.onchain.route_ready', {
    where,
    mintHistoryEntryLength: params.mintHistoryEntry.length,
    unit: params.unit ?? null,
    hasMintListCallback: !!onRequestMintList,
  });

  return (
    <>
      <OnchainReceiveRouteContent
        mintHistoryEntry={params.mintHistoryEntry}
        onRequestMintList={onRequestMintList}
      />
      {flowBinding}
    </>
  );
}

function OnchainReceiveRouteContent({
  mintHistoryEntry,
  onRequestMintList,
}: {
  mintHistoryEntry: string;
  onRequestMintList?: () => void;
}) {
  const screenOptions = useMemo(() => ({ title: 'Receive onchain' }), []);
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'mintQuote',
    mintHistoryEntry
  );
  const typedEntry = entry as OnchainReceiveEntry | null | undefined;
  const mintInfo = useMintInfo(typedEntry?.mintUrl);

  useEffect(() => {
    if (error) paymentLog.warn('receive.onchain.error', { error });
  }, [error]);

  useEffect(() => {
    if (!typedEntry) return;
    paymentLog.debug('receive.onchain.route_entry', {
      state: typedEntry.state,
      amount: typedEntry.amount,
      unit: typedEntry.unit,
      hasMintInfo: !!mintInfo,
      actionNames: Object.keys(actions),
      source,
      hasMintUrl: !!mintUrl,
    });
  }, [actions, mintInfo, mintUrl, source, typedEntry]);

  if (error) {
    return (
      <ScreenErrorState
        message={error}
        onGoBack={() => {
          void actions.back.execute();
        }}
      />
    );
  }

  if (!typedEntry) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <OnchainReceiveScreen
        entry={typedEntry}
        actions={actions as Record<'copy' | 'share' | 'back', BoundAction>}
        source={source}
        mintUrl={mintUrl}
        mintInfo={mintInfo}
        onRequestMintList={onRequestMintList}
      />
    </>
  );
}
