import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import { normalizeMintUrl } from '@cashu/coco-core';
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
// the mint's state. One `refresh` on open re-checks the mint; after that the
// page follows Coco's `melt-quote:updated`. Coco's melt-quote watcher keeps an
// `onchain_melt_quote` subscription (WebSocket, polling fallback) for an
// unexpired quote and for as long as its melt operation is pending
// (coco `services/watchers/MeltQuoteWatcherService.ts:122-131,295-321`,
// `MeltSettlementProcessor.ts:155-158,261-297`), and emits the event once per
// change (`quotes/QuoteLifecycle.ts:1647-1666`) — never again for the same
// state. So no event may be dropped: one that lands while a refresh is out is
// held and the newer of it and the refresh result is applied once the refresh
// settles, whether it succeeded or not. A refresh that fails falls back to the
// row Coco saved locally (offline, a PAID row is never watched again:
// `MeltQuoteRepository.ts:213`). And because an event can still be missed
// (the app was suspended, the socket dropped), a slow safety re-check runs
// while the page is focused and the quote not settled: 30 s, then doubling
// up to 5 min — not the old 12 s poll.
const SAFETY_RECHECK_FIRST_MS = 30_000;
const SAFETY_RECHECK_MAX_MS = 5 * 60_000;
// One quick confirm re-check after the FIRST PAID-without-outpoint read — the
// mint may publish the outpoint a beat after flipping PAID.
const OFFCHAIN_CONFIRM_REFETCH_MS = 3_000;
// A failed confirm re-check is tried again a few times, each wait twice the
// last up to this: a mint that went away is not asked every three seconds for
// as long as the page stays open. Once the tries are spent the verdict stays
// open, and the next time the page opens it is asked again.
const OFFCHAIN_CONFIRM_RETRY_MAX_MS = 60_000;
const OFFCHAIN_CONFIRM_MAX_RETRIES = 6;

type MeltQuoteUpdated = { mintUrl: string; quoteId: string; quote: unknown };
type QuoteRecord = Record<string, unknown>;

const readOutpoint = (record: QuoteRecord | null): string | null =>
  typeof record?.outpoint === 'string' && record.outpoint.trim() ? record.outpoint.trim() : null;

/**
 * Whether `next` is a newer observation of the quote than `prev`, by Coco's
 * own ordering: a PAID row never goes back (its merge is PAID-sticky), a later
 * `updatedAt` wins, and otherwise only an observation that differs (another
 * state, a new outpoint) counts — so the event a refresh itself causes is not
 * taken as a second read.
 */
function isNewerQuoteObservation(next: QuoteRecord | null, prev: QuoteRecord | null): boolean {
  if (!next) return false;
  if (!prev) return true;
  if (prev.state === 'PAID' && next.state !== 'PAID') return false;
  const nextAt = typeof next.updatedAt === 'number' ? next.updatedAt : null;
  const prevAt = typeof prev.updatedAt === 'number' ? prev.updatedAt : null;
  if (nextAt != null && prevAt != null && nextAt !== prevAt) return nextAt > prevAt;
  if (next.state !== prev.state) return true;
  return !!readOutpoint(next) && !readOutpoint(prev);
}

interface MeltQuoteWatchCtx {
  manager: {
    on: (event: 'melt-quote:updated', handler: (payload: MeltQuoteUpdated) => void) => () => void;
    quotes: {
      melt: {
        refresh: (args: { mintUrl: string; quoteId: string }) => Promise<unknown>;
        get: (args: { mintUrl: string; quoteId: string }) => Promise<unknown>;
      };
    };
  };
  mintUrl: string;
  quoteId: string;
  setQuote: (quote: Record<string, unknown> | null) => void;
  /** Which quote the hook's state now describes. */
  setWatched: (key: string) => void;
  setIsLoading: (loading: boolean) => void;
  setOffchainSettled: (settled: boolean) => void;
  persistedVerdictRef: MutableRefObject<boolean>;
  entrySettledRef: MutableRefObject<boolean>;
  /** The melt operation is still executing or pending (not prepared, not ended). */
  operationInFlightRef: MutableRefObject<boolean>;
  /** The page is focused: only then do safety re-checks run. */
  active: boolean;
  annotatedOutpointForQuoteRef: MutableRefObject<string | null>;
  annotatedVerdictForQuoteRef: MutableRefObject<string | null>;
  annotatedDestinationForQuoteRef: MutableRefObject<string | null>;
}

interface MeltQuoteWatch {
  setActive: (active: boolean) => void;
  stop: () => void;
}

/** The effect body of useOnchainMeltQuote. */
function watchOnchainMeltQuote(ctx: MeltQuoteWatchCtx): MeltQuoteWatch {
  const {
    manager,
    mintUrl,
    quoteId,
    setQuote,
    setWatched,
    setIsLoading,
    setOffchainSettled,
    persistedVerdictRef,
    entrySettledRef,
    operationInFlightRef,
    annotatedOutpointForQuoteRef,
    annotatedVerdictForQuoteRef,
    annotatedDestinationForQuoteRef,
  } = ctx;
  let mounted = true;
  let active = ctx.active;
  let stopWatching: (() => void) | null = null;
  let confirmTimeout: ReturnType<typeof setTimeout> | null = null;
  let safetyTimeout: ReturnType<typeof setTimeout> | null = null;
  let safetyRechecks = 0;
  // Nothing on the page can change any more: PAID, an expired quote with no
  // operation in flight, or a persisted off-chain verdict.
  let settled = persistedVerdictRef.current;
  let latest: QuoteRecord | null = null;
  let settlement = INITIAL_OFFCHAIN_SETTLEMENT_STATE;
  // Watching has stopped on PAID and the one follow-up read is what decides
  // between "no transaction" and "outpoint published late". If that read
  // fails nothing else is scheduled, so it has to be tried again.
  let awaitingVerdict = false;
  let failedVerdictReads = 0;
  // Captured once per quote: an entry that was already finalized needs only
  // one fresh PAID-no-outpoint read (coco's finalize check was the other).
  const requiredVerdictReads = entrySettledRef.current ? 1 : 2;
  // A different quote starts from nothing: the previous one's state and
  // outpoint must not be read as this one's for even one render.
  setQuote(null);
  setWatched(`${mintUrl}|${quoteId}`);
  setOffchainSettled(persistedVerdictRef.current);
  paymentLog.debug('onchain.melt.quote.watch_start', {
    persistedVerdict: persistedVerdictRef.current,
    entrySettledAtMount: entrySettledRef.current,
    requiredVerdictReads,
  });
  const stopListening = () => {
    if (stopWatching) {
      stopWatching();
      stopWatching = null;
    }
  };
  const clearSafety = () => {
    if (safetyTimeout) {
      clearTimeout(safetyTimeout);
      safetyTimeout = null;
    }
  };
  const scheduleSafetyRecheck = () => {
    if (!mounted || !active || settled || safetyTimeout) return;
    const wait = Math.min(SAFETY_RECHECK_FIRST_MS * 2 ** safetyRechecks, SAFETY_RECHECK_MAX_MS);
    safetyRechecks += 1;
    safetyTimeout = setTimeout(() => {
      safetyTimeout = null;
      void fetchQuote().then(scheduleSafetyRecheck);
    }, wait);
  };
  /**
   * Applies one observation. `fresh` is false for the locally saved row read
   * after a failed refresh: it is shown, but it is not a new read from the
   * mint, so it does not count toward the off-chain verdict.
   */
  const applyQuote = (result: unknown, fresh = true) => {
    const record = (result as QuoteRecord | null) ?? null;
    latest = record;
    setQuote(record);
    const state = typeof record?.state === 'string' ? record.state : null;
    const expiry = typeof record?.expiry === 'number' ? record.expiry : null;
    const outpoint = readOutpoint(record);
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
    if (fresh || outpoint) {
      settlement = nextOffchainSettlementState(settlement, {
        state,
        hasOutpoint: !!outpoint,
      });
    }
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
      fresh,
      hasOutpoint: !!outpoint,
      state,
      hasExpiry: expiry != null,
      paidNoOutpointReads: settlement.paidNoOutpointReads,
    });
    // PAID is terminal (coco's merge is PAID-sticky) — stop listening and
    // re-checking while the detail stays open. Exception: the FIRST
    // PAID-without-outpoint read gets one quick confirm re-check before the
    // off-chain verdict is believed (the outpoint may land a beat later).
    // An expired quote that never left UNPAID is equally terminal — but only
    // once no melt operation is in flight: Coco keeps watching while one is.
    if (state === 'PAID') {
      settled = true;
      clearSafety();
      stopListening();
      if (
        !outpoint &&
        !isConfirmedOffchainSettlement(settlement, requiredVerdictReads) &&
        !confirmTimeout
      ) {
        awaitingVerdict = true;
        confirmTimeout = setTimeout(() => {
          confirmTimeout = null;
          void fetchQuote();
        }, OFFCHAIN_CONFIRM_REFETCH_MS);
      } else {
        awaitingVerdict = false;
      }
    } else if (
      isOnchainMeltQuoteExpired(state, expiry, Date.now()) &&
      !operationInFlightRef.current
    ) {
      settled = true;
      clearSafety();
      stopListening();
    }
  };
  // Events that land while a refresh is out are held, newest by Coco's
  // ordering, and weighed against the refresh's own result once it settles.
  let refreshing = 0;
  let heldEvent: QuoteRecord | null = null;
  const applyNewest = (observed: QuoteRecord | null, fresh: boolean) => {
    const held = heldEvent;
    heldEvent = null;
    if (held && isNewerQuoteObservation(held, observed ?? latest)) {
      applyQuote(held);
      return;
    }
    if (observed && isNewerQuoteObservation(observed, latest)) applyQuote(observed, fresh);
    else if (observed && fresh) applyQuote(observed);
  };
  const readLocalQuote = async (): Promise<QuoteRecord | null> => {
    try {
      return ((await manager.quotes.melt.get({ mintUrl, quoteId })) as QuoteRecord | null) ?? null;
    } catch (err) {
      paymentLog.warn('onchain.melt.quote.local_read_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  };
  const fetchQuote = async () => {
    setIsLoading(true);
    refreshing += 1;
    try {
      let result: unknown;
      try {
        result = await manager.quotes.melt.refresh({ mintUrl, quoteId });
      } finally {
        refreshing -= 1;
      }
      if (!mounted) return;
      failedVerdictReads = 0;
      applyNewest((result as QuoteRecord | null) ?? null, true);
    } catch (err) {
      paymentLog.warn('onchain.melt.quote.refresh_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!mounted) return;
      applyNewest(await readLocalQuote(), false);
      if (
        mounted &&
        awaitingVerdict &&
        !confirmTimeout &&
        failedVerdictReads < OFFCHAIN_CONFIRM_MAX_RETRIES
      ) {
        const wait = Math.min(
          OFFCHAIN_CONFIRM_REFETCH_MS * 2 ** failedVerdictReads,
          OFFCHAIN_CONFIRM_RETRY_MAX_MS
        );
        failedVerdictReads += 1;
        confirmTimeout = setTimeout(() => {
          confirmTimeout = null;
          void fetchQuote();
        }, wait);
      }
    } finally {
      if (mounted) setIsLoading(false);
    }
  };
  // A persisted settled-off-chain verdict is terminal: one self-heal refresh
  // (in case the mint published the outpoint late) instead of watching.
  if (!persistedVerdictRef.current) {
    const watchedMint = normalizeMintUrl(mintUrl);
    stopWatching = manager.on('melt-quote:updated', (update) => {
      if (!mounted || update.quoteId !== quoteId) return;
      if (normalizeMintUrl(update.mintUrl) !== watchedMint) return;
      const record = (update.quote as QuoteRecord | null) ?? null;
      if (refreshing > 0) {
        if (isNewerQuoteObservation(record, heldEvent)) heldEvent = record;
        return;
      }
      if (isNewerQuoteObservation(record, latest)) applyQuote(record);
    });
  }
  void fetchQuote().then(scheduleSafetyRecheck);
  return {
    setActive: (next) => {
      if (next === active) return;
      active = next;
      if (!active) clearSafety();
      else {
        safetyRechecks = 0;
        scheduleSafetyRecheck();
      }
    },
    stop: () => {
      mounted = false;
      stopListening();
      clearSafety();
      if (confirmTimeout) {
        clearTimeout(confirmTimeout);
        confirmTimeout = null;
      }
    },
  };
}

/**
 * Live onchain melt-quote fields for the send-detail timeline — the `outpoint`
 * (once the mint broadcasts), the mint `state` (UNPAID/PENDING/PAID), and the
 * `request` (recipient bitcoin address, the source of truth for a persisted
 * entry that carries no metadata). Fetched once via `manager.quotes.melt.refresh`
 * (a live mint re-check, the saved row if that fails), then updated from
 * Coco's `melt-quote:updated` so the outpoint + PAID flip land without a
 * manual reload, with a slow safety re-check while focused. It stops once the
 * quote reaches PAID, or expires with no melt operation in flight.
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
    /**
     * The melt operation is executing or pending. While it is, the quote is
     * followed whatever its expiry (Coco keeps watching it too).
     */
    operationInFlight?: boolean;
    /** The page is focused; safety re-checks run only then. Defaults to true. */
    active?: boolean;
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
  const [storedQuote, setQuote] = useState<Record<string, unknown> | null>(null);
  // State is set from an effect, which runs AFTER the render that first sees
  // a new quote id. Until the effect has claimed the state for that id, what
  // is stored belongs to the previous quote and is not exposed at all —
  // otherwise one payment's PAID and outpoint are drawn on another.
  const [watched, setWatched] = useState<string | null>(null);
  const isCurrent = !!mintUrl && !!quoteId && watched === `${mintUrl}|${quoteId}`;
  const quote = isCurrent ? storedQuote : null;
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
  // Read inside the effect without restarting the watch when the annotation
  // lands mid-session (e.g. the melt-op:finalized writer fires while open).
  const persistedVerdictRef = useLatestRef(persistedVerdict);
  const entrySettledRef = useLatestRef(opts?.entrySettledAtMount === true);
  const operationInFlightRef = useLatestRef(opts?.operationInFlight === true);
  const active = opts?.active !== false;
  const activeRef = useLatestRef(active);
  const watchRef = useRef<MeltQuoteWatch | null>(null);

  useEffect(() => {
    if (!manager || !mintUrl || !quoteId) {
      setQuote(null);
      setIsLoading(false);
      setOffchainSettled(false);
      return;
    }
    const watch = watchOnchainMeltQuote({
      manager,
      mintUrl,
      quoteId,
      setQuote,
      setWatched,
      setIsLoading,
      setOffchainSettled,
      persistedVerdictRef,
      entrySettledRef,
      operationInFlightRef,
      active: activeRef.current,
      annotatedOutpointForQuoteRef,
      annotatedVerdictForQuoteRef,
      annotatedDestinationForQuoteRef,
    });
    watchRef.current = watch;
    return () => {
      watch.stop();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [
    manager,
    mintUrl,
    quoteId,
    persistedVerdictRef,
    entrySettledRef,
    operationInFlightRef,
    activeRef,
  ]);

  // Focus only pauses or resumes the safety re-check; the watch itself (and
  // what it has seen) carries on.
  useEffect(() => {
    watchRef.current?.setActive(active);
  }, [active]);

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
    offchainSettled: (isCurrent && offchainSettled) || persistedVerdict,
    isLoading,
  };
}
