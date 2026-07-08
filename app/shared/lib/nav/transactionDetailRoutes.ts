import type { HistoryEntry } from '@cashu/coco-core';
import { isPendingPaymentRequestEntry } from 'wallet';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { getOnchainMeltAddress } from '@/shared/lib/cashu/onchainMelt';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { cashuLog } from '@/shared/lib/logger';

type MintDetailPathname = '/lightningReceive' | '/onchainReceive';
type MeltDetailPathname = '/lightningSend' | '/onchainSend';

export function getMintDetailPathname(entry: HistoryEntry): MintDetailPathname {
  const isOnchain = !!getOnchainMintAddress(entry);
  const pathname = isOnchain ? '/onchainReceive' : '/lightningReceive';
  cashuLog.debug('transactions.detail_route.mint', {
    type: entry.type,
    state:
      typeof (entry as Record<string, unknown>).state === 'string'
        ? (entry as Record<string, unknown>).state
        : null,
    isOnchain,
    pathname,
  });
  return pathname;
}

export function getMeltDetailPathname(entry: HistoryEntry): MeltDetailPathname {
  const isOnchain = !!getOnchainMeltAddress(entry);
  const pathname = isOnchain ? '/onchainSend' : '/lightningSend';
  cashuLog.debug('transactions.detail_route.melt', {
    type: entry.type,
    state:
      typeof (entry as Record<string, unknown>).state === 'string'
        ? (entry as Record<string, unknown>).state
        : null,
    isOnchain,
    pathname,
  });
  return pathname;
}

/**
 * Open a transaction's detail screen for VIEWING from a history row.
 *
 * These detail screens are shared with the live receive/send flows, and the tap
 * often resolves into the receive/send-flow route group, so we tag the route
 * with `historyView: '1'`. `useIsTransactionHistoryView()` reads that tag and
 * the screens render a read-only "Receiving/Sent with" mint row instead of a
 * clickable `MintSelector`. `source` is telemetry only.
 */
export function navigateToTransactionDetail(entry: HistoryEntry, source: string): void {
  const serialized = JSON.stringify(entry);
  const state =
    typeof (entry as Record<string, unknown>).state === 'string'
      ? ((entry as Record<string, unknown>).state as string)
      : null;
  const logOpen = (pathname: string): void =>
    cashuLog.info('transactions.detail.open', {
      source,
      type: entry.type,
      state,
      pathname,
      serializedLength: serialized.length,
      historyView: true,
    });

  // A synthetic pending incoming-request row is type 'receive' but must reopen
  // the request screen (QR + waiting state), not the received-token detail.
  // Reconstruct the screen's param from the metadata the synthetic entry carries.
  if (isPendingPaymentRequestEntry(entry)) {
    const md = (entry.metadata ?? {}) as Record<string, string>;
    const amount = Number(md.requestAmount);
    // The synthetic row always carries these; guard so a malformed row logs
    // instead of pushing an unparseable param that the screen renders as an error.
    if (
      !md.operationId ||
      !md.encodedRequest ||
      !md.requestUnit ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      cashuLog.warn('transactions.detail.pending_request_incomplete', {
        hasOperationId: !!md.operationId,
        hasEncodedRequest: !!md.encodedRequest,
        hasUnit: !!md.requestUnit,
        amountFinite: Number.isFinite(amount),
      });
      return;
    }
    let mints: string[] = [];
    try {
      mints = JSON.parse(md.requestMints ?? '[]');
    } catch {
      mints = [];
    }
    const paymentRequestEntry = JSON.stringify({
      operationId: md.operationId,
      encodedRequest: md.encodedRequest,
      amount,
      unit: md.requestUnit,
      mints,
    });
    logOpen('/paymentRequest');
    router.navigate({
      pathname: '/paymentRequest',
      params: { paymentRequestEntry, historyView: '1' },
    });
    return;
  }

  switch (entry.type) {
    case 'mint': {
      const pathname = getMintDetailPathname(entry);
      logOpen(pathname);
      router.navigate({ pathname, params: { mintHistoryEntry: serialized, historyView: '1' } });
      return;
    }
    case 'melt': {
      const pathname = getMeltDetailPathname(entry);
      logOpen(pathname);
      router.navigate({ pathname, params: { meltHistoryEntry: serialized, historyView: '1' } });
      return;
    }
    case 'send': {
      logOpen('/sendToken');
      router.navigate({
        pathname: '/sendToken',
        params: { sendHistoryEntry: serialized, historyView: '1' },
      });
      return;
    }
    case 'receive': {
      logOpen('/receiveToken');
      router.navigate({
        pathname: '/receiveToken',
        params: { receiveHistoryEntry: serialized, historyView: '1' },
      });
      return;
    }
  }
}
