import { useCallback, useEffect, useRef, useState } from "react";

import { logger } from "../logger";
import {
  ensureStandingPaymentRequest,
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
  const [request, setRequest] = useState<StandingPaymentRequest | null>(null);
  const [isLoading, setIsLoading] = useState(!!input);
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

  useEffect(() => {
    if (!unit || mintsKey === null) {
      setRequest(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        // Lock changes only re-ENCODE the same operation, so they are
        // excluded from the fresh key — toggling P2PK never rotates.
        const inputKey = `${unit}|${mintsKey}`;
        const wantFresh = freshOnMount && freshDoneForRef.current !== inputKey;
        if (wantFresh) freshDoneForRef.current = inputKey;
        const requestInput = { unit, mints: mintsRef.current, lockP2pkPubkey };
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
  }, [manager, unit, mintsKey, lockP2pkPubkey, generation, freshOnMount]);

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
        { unit, mints: mintsRef.current, lockP2pkPubkey },
        identityStoreRef.current,
      );
      if (mountedRef.current) setRequest(created);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("creq.standing.rotate_failed", { unit, error: message });
      if (mountedRef.current) setError(message);
    }
  }, [manager, unit, lockP2pkPubkey]);

  return { request, isLoading, error, rotate };
}
