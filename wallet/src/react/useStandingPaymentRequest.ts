import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "../logger";
import {
  ensureStandingPaymentRequest,
  peekStandingPaymentRequest,
  rotateStandingPaymentRequest,
  standingPaymentRequestKey,
  type StandingPaymentRequest,
  type StandingPaymentRequestInput,
} from "../payment-request-receive";
import type { ReusableQuoteIdentityStore } from "../quotes/reusable";
import { useColadaManager } from "./ColadaProvider";

export interface UseStandingPaymentRequestResult {
  request: StandingPaymentRequest | null;
  isLoading: boolean;
  error: string | null;
  /** Cancel the current request and mint a fresh one (new request id). */
  rotate: () => Promise<void>;
}

/**
 * React binding for the standing NUT-18 payment request (the Cashu receive
 * rail): resolves the ONE active reusable request recorded in the identity
 * store, mirrors useReusableMintQuote's shape, and re-resolves when an
 * external rotation lands in the store.
 */
export function useStandingPaymentRequest(
  input: StandingPaymentRequestInput | null,
  identityStore: ReusableQuoteIdentityStore,
  options?: {
    /** Mint a FRESH request on first resolve for this (unit, mints) input —
     *  cancels the recorded op and creates a new id, so every visit hands
     *  out a new request. Subsequent re-resolves (event-driven) reuse it. */
    freshOnMount?: boolean;
  },
): UseStandingPaymentRequestResult {
  const freshOnMount = options?.freshOnMount ?? false;
  const freshDoneForRef = useRef<string | null>(null);
  const manager = useColadaManager();
  // Seed from the last resolved value (per-manager cache) so re-mounts render
  // synchronously; the effect revalidates and swaps in place. EXCEPT with
  // freshOnMount: the cached request is exactly what the pending rotation is
  // about to retire — seeding it would flash (and let consumers copy/encode)
  // a request that is already doomed. Fresh consumers load until the fresh
  // request lands.
  const [request, setRequest] = useState<StandingPaymentRequest | null>(() =>
    input && !freshOnMount ? peekStandingPaymentRequest(manager, input) : null,
  );
  const [isLoading, setIsLoading] = useState(!!input && !request);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const identityStoreRef = useRef(identityStore);
  identityStoreRef.current = identityStore;
  const operationIdRef = useRef<string | null>(null);
  operationIdRef.current = request?.operationId ?? null;

  const unit = input?.unit ?? null;
  // Mint list identity: order-stable join so a re-render with the same mints
  // doesn't re-resolve, while trust changes do.
  const mintsKey = input ? input.mints.join("|") : null;
  const mintsRef = useRef<string[]>(input?.mints ?? []);
  mintsRef.current = input?.mints ?? [];
  const lockP2pkPubkey = input?.lockP2pkPubkey;
  // Display-mint identity: like the lock, a change only re-ENCODEs the same
  // operation (never rotates), so it triggers the effect but stays out of
  // the fresh key.
  const displayMintsKey = input?.displayMints?.join("|");
  const displayMintsRef = useRef<string[] | undefined>(input?.displayMints);
  displayMintsRef.current = input?.displayMints;

  useEffect(() => {
    if (!unit || mintsKey === null) {
      setRequest(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    // Lock and display-mint changes only re-ENCODE the same operation, so
    // they are excluded from the fresh key — toggling P2PK or a mint never
    // rotates.
    const inputKey = `${unit}|${mintsKey}`;
    const wantFresh = freshOnMount && freshDoneForRef.current !== inputKey;
    // Cached seeds revalidate silently (stale-while-revalidate); show a
    // loading state when there is nothing to render OR when the cached
    // value is about to be rotated away (fresh pending — never show it).
    if (wantFresh) {
      setRequest(null);
      setIsLoading(true);
    } else if (
      !peekStandingPaymentRequest(manager, {
        unit,
        mints: mintsRef.current,
        lockP2pkPubkey,
        displayMints: displayMintsRef.current,
      })
    ) {
      setIsLoading(true);
    }
    setError(null);
    (async () => {
      try {
        if (wantFresh) freshDoneForRef.current = inputKey;
        const requestInput = {
          unit,
          mints: mintsRef.current,
          lockP2pkPubkey,
          displayMints: displayMintsRef.current,
        };
        const resolved = wantFresh
          ? await rotateStandingPaymentRequest(
              manager,
              requestInput,
              identityStoreRef.current,
            )
          : await ensureStandingPaymentRequest(
              manager,
              requestInput,
              identityStoreRef.current,
            );
        if (!cancelled && mountedRef.current) setRequest(resolved);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("creq.standing.ensure_failed", { unit, error: message });
        if (!cancelled && mountedRef.current) setError(message);
      } finally {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manager, unit, mintsKey, lockP2pkPubkey, displayMintsKey, generation, freshOnMount]);

  // External rotations land in the identity store — re-resolve.
  useEffect(() => {
    if (!unit) return;
    const store = identityStoreRef.current;
    if (!store.subscribe) return;
    const key = standingPaymentRequestKey(unit);
    return store.subscribe(key, () => {
      const recorded = identityStoreRef.current.get(key);
      if (recorded && recorded === operationIdRef.current) return;
      setGeneration((g) => g + 1);
    });
  }, [unit]);

  const rotate = useCallback(async () => {
    if (!unit) return;
    try {
      const created = await rotateStandingPaymentRequest(
        manager,
        {
          unit,
          mints: mintsRef.current,
          lockP2pkPubkey,
          displayMints: displayMintsRef.current,
        },
        identityStoreRef.current,
      );
      if (mountedRef.current) setRequest(created);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("creq.standing.rotate_failed", { unit, error: message });
      if (mountedRef.current) setError(message);
    }
  }, [manager, unit, lockP2pkPubkey]);

  // Auto-rotation when a payment lands on the CURRENT standing request is driven
  // centrally by `usePaymentStatusListener` (the same chokepoint that rotates the
  // onchain deposit rail): it writes a fresh op id into the identity store, which
  // the observation effect above picks up and re-resolves. Keeping it there means
  // rotation happens even when this screen is closed.
  return { request, isLoading, error, rotate };
}
