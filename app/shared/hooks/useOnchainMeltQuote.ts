import { useEffect, useRef, useState } from 'react';

import { useManagerContext } from '@cashu/coco-react';

import { annotationKey } from 'wallet';

import {
  INITIAL_OFFCHAIN_SETTLEMENT_STATE,
  isConfirmedOffchainSettlement,
  isOnchainMeltQuoteExpired,
  nextOffchainSettlementState,
  normalizeOnchainFeeOptions,
  type OnchainMeltFeeOption,
} from '@/shared/lib/cashu/onchainMelt';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';
import { paymentLog } from '@/shared/lib/logger';

// The onchain melt quote is the source of truth for the outpoint (txid:vout) and
// the mint's state. `manager.quotes.melt.get` reads a LOCAL row that never
// self-refreshes, so polling it can't pull a PENDING→PAID transition; we poll
// `refresh` instead, which re-checks the mint and cascades the row → PAID +
// finalize. Polled while the detail is open, then stopped once settled.
const MELT_QUOTE_POLL_MS = 12_000;
// One quick confirm re-check after the FIRST PAID-without-outpoint read — the
// mint may publish the outpoint a beat after flipping PAID.
const OFFCHAIN_CONFIRM_REFETCH_MS = 3_000;

/**
 * Live onchain melt-quote fields for the send-detail timeline — the `outpoint`
 * (once the mint broadcasts), the mint `state` (UNPAID/PENDING/PAID), and the
 * `request` (recipient bitcoin address, the source of truth for a persisted
 * entry that carries no metadata). Fetched via `manager.quotes.melt.refresh`
 * (a live mint re-check) and polled while mounted so the outpoint + PAID flip
 * land without a manual reload; polling stops once the quote reaches PAID.
 */
export function useOnchainMeltQuote(
  mintUrl: string | null | undefined,
  quoteId: string | null | undefined
): {
  outpoint: string | null;
  state: string | null;
  request: string | null;
  expiry: number | null;
  feeOptions: OnchainMeltFeeOption[];
  /** Debounced "PAID with no outpoint" verdict — see nextOffchainSettlementState. */
  offchainSettled: boolean;
  isLoading: boolean;
} {
  const { manager } = useManagerContext();
  const [quote, setQuote] = useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [offchainSettled, setOffchainSettled] = useState(false);
  // One annotation write per quote — covers mints that broadcast AFTER the
  // operation finalized (the melt-op:finalized writer saw no outpoint yet).
  const annotatedOutpointForQuoteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!manager || !mintUrl || !quoteId) {
      setQuote(null);
      setIsLoading(false);
      setOffchainSettled(false);
      return;
    }
    let mounted = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    let confirmTimeout: ReturnType<typeof setTimeout> | null = null;
    let settlement = INITIAL_OFFCHAIN_SETTLEMENT_STATE;
    setOffchainSettled(false);
    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const fetchQuote = async () => {
      setIsLoading(true);
      try {
        const result = await manager.quotes.melt.refresh({ mintUrl, quoteId });
        if (!mounted) return;
        const record = (result as unknown as Record<string, unknown> | null) ?? null;
        setQuote(record);
        const state = typeof record?.state === 'string' ? record.state : null;
        const expiry = typeof record?.expiry === 'number' ? record.expiry : null;
        const outpoint =
          typeof record?.outpoint === 'string' && record.outpoint.trim()
            ? record.outpoint.trim()
            : null;
        // Persist the outpoint the first time the mint surfaces it, so the
        // explorer link survives the mint pruning this quote row later.
        if (outpoint && annotatedOutpointForQuoteRef.current !== quoteId) {
          annotatedOutpointForQuoteRef.current = quoteId;
          setTransactionAnnotation(annotationKey({ type: 'melt', quoteId }), {
            onchainMelt: { outpoint },
          });
        }
        settlement = nextOffchainSettlementState(settlement, {
          state,
          hasOutpoint: !!outpoint,
        });
        setOffchainSettled(isConfirmedOffchainSettlement(settlement));
        paymentLog.debug('onchain.melt.quote.result', {
          found: !!record,
          hasOutpoint: !!outpoint,
          state,
          hasExpiry: expiry != null,
          paidNoOutpointReads: settlement.paidNoOutpointReads,
        });
        // PAID is terminal (coco's merge is PAID-sticky) — stop re-checking the
        // mint while the detail stays open. Exception: the FIRST
        // PAID-without-outpoint read gets one quick confirm re-check before the
        // off-chain verdict is believed (the outpoint may land a beat later).
        // An expired quote that never left UNPAID is equally terminal.
        if (state === 'PAID') {
          stopPolling();
          if (!outpoint && !isConfirmedOffchainSettlement(settlement) && !confirmTimeout) {
            confirmTimeout = setTimeout(() => {
              confirmTimeout = null;
              void fetchQuote();
            }, OFFCHAIN_CONFIRM_REFETCH_MS);
          }
        } else if (isOnchainMeltQuoteExpired(state, expiry, Date.now())) {
          stopPolling();
        }
      } catch (err) {
        paymentLog.warn('onchain.melt.quote.refresh_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void fetchQuote();
    interval = setInterval(() => void fetchQuote(), MELT_QUOTE_POLL_MS);
    return () => {
      mounted = false;
      stopPolling();
      if (confirmTimeout) {
        clearTimeout(confirmTimeout);
        confirmTimeout = null;
      }
    };
  }, [manager, mintUrl, quoteId]);

  const readString = (key: string): string | null => {
    const value = quote?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const expiryValue = quote?.expiry;

  return {
    outpoint: readString('outpoint'),
    state: readString('state'),
    request: readString('request'),
    expiry: typeof expiryValue === 'number' && Number.isFinite(expiryValue) ? expiryValue : null,
    feeOptions: normalizeOnchainFeeOptions(quote?.fee_options),
    offchainSettled,
    isLoading,
  };
}
