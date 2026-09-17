/**
 * @fileoverview Resolving a mint-quote receive route into screen props.
 *
 * All three mint-quote routes (Lightning, onchain, custom) take the same
 * `mintHistoryEntry` param and need the same four things out of it: the
 * decoded entry, the bound screen actions, the mint it belongs to, and that
 * mint's info. Doing it here means the method screens are handed a resolved
 * entry and never render a loading or error state themselves.
 */

import { useEffect } from 'react';

import { useScreenActions } from 'wallet/react';

import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { mintQuoteMethod } from '@/shared/lib/cashu/mintQuoteRail';
import { paymentLog } from '@/shared/lib/logger';
import { getPaymentMethodLabel } from 'wallet';

import type { MintQuoteActions, MintQuoteReceiveEntry } from './MintQuoteReceiveShell';

interface ResolvedMintQuoteScreen {
  entry: MintQuoteReceiveEntry | null;
  actions: MintQuoteActions;
  source: string | null;
  mintUrl?: string;
  mintInfo: ReturnType<typeof useMintInfo>;
  error: string | null;
  /** The mint-advertised method this quote was created with. */
  method: string;
}

/** Title for a mint-quote screen's navigation bar, e.g. "Receive PayPal". */
export function mintQuoteScreenTitle(method: string): string {
  return `Receive ${getPaymentMethodLabel(method)}`;
}

export function useMintQuoteScreen(
  mintHistoryEntry: string,
  logScope: string
): ResolvedMintQuoteScreen {
  const { entry, error, actions, source, mintUrl } = useScreenActions(
    'mintQuote',
    mintHistoryEntry
  );
  const typedEntry = entry as MintQuoteReceiveEntry | null | undefined;
  const mintInfo = useMintInfo(typedEntry?.mintUrl);
  const method = mintQuoteMethod(typedEntry);

  useEffect(() => {
    if (error) paymentLog.warn(`${logScope}.error`, { error });
  }, [error, logScope]);

  useEffect(() => {
    if (!typedEntry) return;
    paymentLog.debug(`${logScope}.route_entry`, {
      state: typedEntry.state,
      amount: typedEntry.amount,
      unit: typedEntry.unit,
      method,
      hasMintInfo: !!mintInfo,
      actionNames: Object.keys(actions),
      source,
      hasMintUrl: !!mintUrl,
    });
  }, [actions, logScope, method, mintInfo, mintUrl, source, typedEntry]);

  return {
    entry: typedEntry ?? null,
    actions: actions as MintQuoteActions,
    source,
    mintUrl,
    mintInfo,
    error: error ?? null,
    method,
  };
}
