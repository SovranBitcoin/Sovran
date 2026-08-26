import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import { useManagerContext } from '@cashu/coco-react';

import { useLatestRef } from '@/shared/hooks/useLatestRef';

import { annotationKey, type TransactionAnnotation } from 'wallet';

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

interface MeltQuoteWatchCtx {
  manager: {
    quotes: {
      melt: { refresh: (args: { mintUrl: string; quoteId: string }) => Promise<unknown> };
    };
  };
  mintUrl: string;
  quoteId: string;
  setQuote: (quote: Record<string, unknown> | null) => void;
  setIsLoading: (loading: boolean) => void;
  setOffchainSettled: (settled: boolean) => void;
  persistedVerdictRef: MutableRefObject<boolean>;
  entrySettledRef: MutableRefObject<boolean>;
  annotatedOutpointForQuoteRef: MutableRefObject<string | null>;
  annotatedVerdictForQuoteRef: MutableRefObject<string | null>;
  annotatedDestinationForQuoteRef: MutableRefObject<string | null>;
}

/** The effect body of useOnchainMeltQuote, verbatim; returns its cleanup. */
function watchOnchainMeltQuote(ctx: MeltQuoteWatchCtx): () => void {
  const {
    manager,
    mintUrl,
    quoteId,
    setQuote,
    setIsLoading,
    setOffchainSettled,
    persistedVerdictRef,
    entrySettledRef,
    annotatedOutpointForQuoteRef,
    annotatedVerdictForQuoteRef,
    annotatedDestinationForQuoteRef,
  } = ctx;
  let mounted = true;
  let interval: ReturnType<typeof setInterval> | null = null;
  let confirmTimeout: ReturnType<typeof setTimeout> | null = null;
  let settlement = INITIAL_OFFCHAIN_SETTLEMENT_STATE;
  // Captured once per quote: an entry that was already finalized needs only
  // one fresh PAID-no-outpoint read (coco's finalize check was the other).
  const requiredVerdictReads = entrySettledRef.current ? 1 : 2;
  setOffchainSettled(persistedVerdictRef.current);
  paymentLog.debug('onchain.melt.quote.watch_start', {
    persistedVerdict: persistedVerdictRef.current,
    entrySettledAtMount: entrySettledRef.current,
    requiredVerdictReads,
  });
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
          onchainMelt: { outpoint, outpointSource: 'mint' },
        });
      }
      // Persist the destination (address + sats) once — the facts the
      // heuristic outpoint discovery needs when a persisted coco row carries
      // no metadata.
      const request =
        typeof record?.request === 'string' && record.request.trim() ? record.request.trim() : null;
      if (request && annotatedDestinationForQuoteRef.current !== quoteId) {
        annotatedDestinationForQuoteRef.current = quoteId;
        const amount = record?.amount;
        const unit = typeof record?.unit === 'string' ? record.unit : null;
        const amountSats =
          typeof amount === 'number' && Number.isFinite(amount) && unit === 'sat'
            ? amount
            : undefined;
        setTransactionAnnotation(annotationKey({ type: 'melt', quoteId }), {
          onchainMelt: {
            address: request,
            ...(amountSats != null ? { amountSats } : {}),
          },
        });
      }
      settlement = nextOffchainSettlementState(settlement, {
        state,
        hasOutpoint: !!outpoint,
      });
      const liveVerdict = isConfirmedOffchainSettlement(settlement, requiredVerdictReads);
      setOffchainSettled(liveVerdict || (persistedVerdictRef.current && !outpoint));
      // Persist the debounced live verdict so the next mount is instant.
      if (liveVerdict && annotatedVerdictForQuoteRef.current !== quoteId) {
        annotatedVerdictForQuoteRef.current = quoteId;
        paymentLog.info('onchain.melt.quote.verdict_persisted', {
          reads: settlement.paidNoOutpointReads,
          requiredVerdictReads,
        });
        setTransactionAnnotation(annotationKey({ type: 'melt', quoteId }), {
          onchainMelt: { settledOffchain: true },
        });
      }
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
        if (
          !outpoint &&
          !isConfirmedOffchainSettlement(settlement, requiredVerdictReads) &&
          !confirmTimeout
        ) {
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
  // A persisted settled-off-chain verdict is terminal: one self-heal refresh
  // (in case the mint published the outpoint late) instead of polling.
  if (!persistedVerdictRef.current) {
    interval = setInterval(() => void fetchQuote(), MELT_QUOTE_POLL_MS);
  }
  return () => {
    mounted = false;
    stopPolling();
    if (confirmTimeout) {
      clearTimeout(confirmTimeout);
      confirmTimeout = null;
    }
  };
}

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
  quoteId: string | null | undefined,
  opts?: {
    /**
     * The persisted `onchainMelt` annotation for this quote, when the caller
     * already has it. A persisted `settledOffchain` verdict (with no outpoint)
     * is believed immediately — the hook then does a single self-heal refresh
     * instead of interval polling, so reopening a settled transaction never
     * re-derives the verdict from live reads.
     */
    persistedOnchainMelt?: TransactionAnnotation['onchainMelt'] | null;
    /**
     * The coco operation was already finalized when the screen opened. coco's
     * own finalize-time quote check found no outpoint (else it would have been
     * annotated), which counts as the first PAID-no-outpoint observation — so
     * ONE fresh read confirms the off-chain verdict instead of the 2-read /
     * 3s-refetch debounce reserved for melts settling live.
     */
    entrySettledAtMount?: boolean;
  }
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
  // Persisted verdict (annotation) — believed immediately, no re-derivation.
  // A persisted outpoint always outranks it (the mint may publish late).
  const persistedVerdict =
    opts?.persistedOnchainMelt?.settledOffchain === true && !opts.persistedOnchainMelt.outpoint;
  const [offchainSettled, setOffchainSettled] = useState(persistedVerdict);
  // One annotation write per quote — covers mints that broadcast AFTER the
  // operation finalized (the melt-op:finalized writer saw no outpoint yet).
  const annotatedOutpointForQuoteRef = useRef<string | null>(null);
  // One verdict + one address/amount annotation write per quote.
  const annotatedVerdictForQuoteRef = useRef<string | null>(null);
  const annotatedDestinationForQuoteRef = useRef<string | null>(null);
  // Read inside the effect without restarting polling when the annotation
  // lands mid-session (e.g. the melt-op:finalized writer fires while open).
  const persistedVerdictRef = useLatestRef(persistedVerdict);
  const entrySettledRef = useLatestRef(opts?.entrySettledAtMount === true);

  useEffect(() => {
    if (!manager || !mintUrl || !quoteId) {
      setQuote(null);
      setIsLoading(false);
      setOffchainSettled(false);
      return;
    }
    return watchOnchainMeltQuote({
      manager,
      mintUrl,
      quoteId,
      setQuote,
      setIsLoading,
      setOffchainSettled,
      persistedVerdictRef,
      entrySettledRef,
      annotatedOutpointForQuoteRef,
      annotatedVerdictForQuoteRef,
      annotatedDestinationForQuoteRef,
    });
  }, [manager, mintUrl, quoteId, persistedVerdictRef, entrySettledRef]);

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
    // OR in the persisted verdict so a late-hydrating annotation still lands
    // without waiting on a live read. Callers gate on `!outpoint` themselves.
    offchainSettled: offchainSettled || persistedVerdict,
    isLoading,
  };
}
