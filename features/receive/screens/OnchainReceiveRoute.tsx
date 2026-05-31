/**
 * @fileoverview Canonical Onchain receive route shell.
 *
 * The underlying Cashu operation is still a mint quote, so this route keeps
 * the `useScreenActions('mintQuote', ...)` contract and renders the onchain
 * rail-specific screen.
 */

import React, { useEffect, useMemo } from 'react';
import { Stack } from 'expo-router';
import { z } from 'zod';
import { useScreenActions, type BoundAction } from 'colada/react';

import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { paymentLog } from '@/shared/lib/logger';
import { useRouteParams } from '@/shared/lib/nav/useRouteParams';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import type { ButtonHandlerButton } from '@/shared/ui/composed/ButtonHandler';

import { OnchainReceiveScreen, type OnchainReceiveEntry } from './OnchainReceiveScreen';

const ParamsSchema = z.object({
  mintHistoryEntry: z.string().min(1).max(64_000),
  unit: z.string().max(16).optional(),
});

interface OnchainReceiveRouteProps {
  /** Log scope for invalid-params telemetry; e.g. `'receive-flow.onchainReceive'`. */
  where: string;
  extraButtons?: ButtonHandlerButton[];
  onRequestMintList?: () => void;
}

export function OnchainReceiveRoute({
  where,
  extraButtons = [],
  onRequestMintList,
}: OnchainReceiveRouteProps) {
  const params = useRouteParams(ParamsSchema, { where });
  if (!params) return null;

  return (
    <OnchainReceiveRouteContent
      mintHistoryEntry={params.mintHistoryEntry}
      extraButtons={extraButtons}
      onRequestMintList={onRequestMintList}
    />
  );
}

function OnchainReceiveRouteContent({
  mintHistoryEntry,
  extraButtons,
  onRequestMintList,
}: {
  mintHistoryEntry: string;
  extraButtons: ButtonHandlerButton[];
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
        extraButtons={extraButtons}
        onRequestMintList={onRequestMintList}
      />
    </>
  );
}
