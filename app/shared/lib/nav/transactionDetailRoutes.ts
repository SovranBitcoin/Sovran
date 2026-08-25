import type { HistoryEntry } from '@cashu/coco-core';
import { isPendingPaymentRequestEntry } from 'wallet';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import { CocoManager } from '@/shared/lib/cashu/manager';
import { getOnchainMeltAddress } from '@/shared/lib/cashu/onchainMelt';
import { getOnchainMintAddress } from '@/shared/lib/cashu/onchainMint';
import { cashuLog } from '@/shared/lib/logger';

type MintDetailPathname = '/lightningReceive' | '/onchainReceive';
type MeltDetailPathname = '/lightningSend' | '/onchainSend';

/** coco's projected entries carry `state` untyped — narrow it for logging. */
function entryState(entry: HistoryEntry): string | null {
  const state = (entry as Record<string, unknown>).state;
  return typeof state === 'string' ? state : null;
}

export function getMintDetailPathname(entry: HistoryEntry): MintDetailPathname {
  const isOnchain = !!getOnchainMintAddress(entry);
  const pathname = isOnchain ? '/onchainReceive' : '/lightningReceive';
  cashuLog.debug('transactions.detail_route.mint', {
    type: entry.type,
    state: entryState(entry),
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
    state: entryState(entry),
    isOnchain,
    pathname,
  });
  return pathname;
}

/**
 * Confident, synchronous melt route when the entry already knows its method — a
 * fresh/synthetic entry (buildMeltEntry) or a bridged scan annotation. Returns
 * null when the method is unknown (a persisted coco entry), signalling the
 * async quote lookup below.
 */
function syncMeltDetailPathname(entry: HistoryEntry): MeltDetailPathname | null {
  const md = ((entry as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
  const method = md.method ?? md.meltQuoteMethod ?? md.paymentMethod;
  if (method === 'onchain' || getOnchainMeltAddress(entry)) return '/onchainSend';
  if (typeof method === 'string' && method) return '/lightningSend'; // bolt11 / bolt12
  return null;
}

/**
 * Robust melt-route resolution for a VIEWED (persisted) history row.
 *
 * coco's projected melt entry carries no payment method (only `quoteId`,
 * `amount`, `state`), so the sync `getMeltDetailPathname` — which reads a
 * synthetic entry's `metadata.method` / bridged scan annotation — falls back to
 * Lightning for a re-opened onchain send (it looked like "Send Lightning" for a
 * scanned bitcoin address). Here we resolve the method from the canonical melt
 * QUOTE (source of truth) via `quoteId`, so the title/screen are always right.
 */
async function resolveMeltDetailPathname(entry: HistoryEntry): Promise<MeltDetailPathname> {
  const known = syncMeltDetailPathname(entry);
  if (known) return known;
  const record = entry as Record<string, unknown>;
  const quoteId = typeof record.quoteId === 'string' ? record.quoteId : null;
  const mintUrl = typeof record.mintUrl === 'string' ? record.mintUrl : null;
  if (quoteId && mintUrl) {
    try {
      const quote = await CocoManager.getInstance().quotes.melt.get({ mintUrl, quoteId });
      const method = (quote as { method?: string } | null)?.method ?? null;
      cashuLog.debug('transactions.detail_route.melt.quote_lookup', {
        found: !!quote,
        method,
      });
      if (method === 'onchain') return '/onchainSend';
      if (method) return '/lightningSend'; // bolt11 / bolt12
    } catch (error) {
      cashuLog.warn('transactions.detail_route.melt.quote_lookup_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return '/lightningSend';
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
  const state = entryState(entry);
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
      const meltParams = { meltHistoryEntry: serialized, historyView: '1' };
      // Known method (fresh/synthetic entry) routes synchronously; a persisted
      // coco entry carries no method, so resolve it from the canonical quote
      // (a few ms local read, fire-and-forget) before navigating.
      const knownPathname = syncMeltDetailPathname(entry);
      if (knownPathname) {
        logOpen(knownPathname);
        router.navigate({ pathname: knownPathname, params: meltParams });
        return;
      }
      void (async () => {
        const pathname = await resolveMeltDetailPathname(entry);
        logOpen(pathname);
        router.navigate({ pathname, params: meltParams });
      })();
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
