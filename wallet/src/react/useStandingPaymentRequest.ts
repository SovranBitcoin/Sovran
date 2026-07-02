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
): UseStandingPaymentRequestResult {
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
        const resolved = await ensureStandingPaymentRequest(
          manager,
          { unit, mints: mintsRef.current },
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
  }, [manager, unit, mintsKey, generation]);

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
        { unit, mints: mintsRef.current },
        identityStoreRef.current,
      );
      if (mountedRef.current) setRequest(created);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("creq.standing.rotate_failed", { unit, error: message });
      if (mountedRef.current) setError(message);
    }
  }, [manager, unit]);

  return { request, isLoading, error, rotate };
}
