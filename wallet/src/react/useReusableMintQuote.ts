import { useCallback, useEffect, useRef, useState } from "react";
import type { Manager } from "@cashu/coco-core";

import { logger, mintUrlFields } from "../logger";
import {
  ensureReusableMintQuote,
  peekReusableMintQuote,
  reusableQuoteKey,
  rotateReusableMintQuote,
  type EnsureReusableMintQuoteInput,
  type ReusableQuoteIdentityStore,
} from "../quotes/reusable";
import { useColadaManager } from "./ColadaProvider";

type ReusableMintQuote = Awaited<
  ReturnType<Manager["quotes"]["mint"]["create"]>
>;

export interface UseReusableMintQuoteResult {
  /** The standing quote (offer/address in `quote.request`), null while loading. */
  quote: ReusableMintQuote | null;
  isLoading: boolean;
  error: string | null;
  /** Re-run get-or-create (e.g. after the quote expired). */
  refresh: () => void;
  /**
   * Retire the standing quote and record a fresh one (onchain address-reuse
   * policy). Keeps showing the current quote until the replacement resolves.
   * `reason` distinguishes a user "new address" tap (`"manual"`, default) from
   * an automatic deposit-detected rotation (`"deposit_received"`).
   */
  rotate: (reason?: "manual" | "deposit_received") => Promise<void>;
}

/**
 * React binding for the reusable-quote singleton: resolves the ONE standing
 * bolt12 offer / onchain address recorded in the app's identity store and
 * re-reads only on `mint-quote:updated` events for THAT quote, so
 * paid/issued totals and expiry stay fresh without the QR churning.
 */
export function useReusableMintQuote(
  input: EnsureReusableMintQuoteInput | null,
  identityStore: ReusableQuoteIdentityStore,
): UseReusableMintQuoteResult {
  const manager = useColadaManager();
  // Seed from the last resolved value (per-manager cache) so re-mounts render
  // the QR synchronously — the effect below still revalidates against the
  // identity store and swaps in place if anything changed.
  const [quote, setQuote] = useState<ReusableMintQuote | null>(() =>
    input ? peekReusableMintQuote(manager, input) : null,
  );
  const [isLoading, setIsLoading] = useState(!!input && !quote);
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
  const quoteIdRef = useRef<string | null>(null);
  quoteIdRef.current = quote?.quoteId ?? null;

  const mintUrl = input?.mintUrl ?? null;
  const method = input?.method ?? null;
  const unit = input?.unit ?? null;

  useEffect(() => {
    if (!mintUrl || !method || !unit) {
      setQuote(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    // Only show a loading state when we have nothing to show — cached seeds
    // revalidate silently (stale-while-revalidate).
    if (!peekReusableMintQuote(manager, { mintUrl, method, unit })) {
      setIsLoading(true);
    }
    setError(null);
    (async () => {
      try {
        const resolved = await ensureReusableMintQuote(
          manager,
          { mintUrl, method, unit },
          identityStoreRef.current,
        );
        if (!cancelled && mountedRef.current) setQuote(resolved);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("quotes.reusable.ensure_failed", {
          ...mintUrlFields(mintUrl),
          method,
          unit,
          error: message,
        });
        if (!cancelled && mountedRef.current) setError(message);
      } finally {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manager, mintUrl, method, unit, generation]);

  // Keep the standing quote's observed state fresh (amountPaid/amountIssued
  // live in quoteData) — only updates for THIS quote trigger a re-read.
  useEffect(() => {
    if (!mintUrl) return;
    const onQuoteUpdated = (payload: { mintUrl: string; quoteId: string }) => {
      if (payload.mintUrl !== mintUrl) return;
      if (!quoteIdRef.current || payload.quoteId !== quoteIdRef.current) return;
      setGeneration((g) => g + 1);
    };
    manager.on("mint-quote:updated", onQuoteUpdated);
    return () => manager.off("mint-quote:updated", onQuoteUpdated);
  }, [manager, mintUrl]);

  // External rotations (e.g. the deposit-received listener retiring the
  // onchain address) land in the identity store — re-resolve so the mounted
  // QR swaps to the fresh quote.
  useEffect(() => {
    if (!mintUrl || !method || !unit) return;
    const store = identityStoreRef.current;
    if (!store.subscribe) return;
    return store.subscribe(reusableQuoteKey({ mintUrl, method, unit }), () => {
      const recorded = identityStoreRef.current.get(
        reusableQuoteKey({ mintUrl, method, unit }),
      );
      if (recorded && recorded === quoteIdRef.current) return;
      setGeneration((g) => g + 1);
    });
  }, [mintUrl, method, unit]);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  const rotate = useCallback(
    async (reason: "manual" | "deposit_received" = "manual") => {
      if (!mintUrl || !method || !unit) return;
      try {
        const created = await rotateReusableMintQuote(
          manager,
          { mintUrl, method, unit },
          identityStoreRef.current,
          reason,
        );
        if (mountedRef.current) setQuote(created);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("quotes.reusable.rotate_failed", {
          ...mintUrlFields(mintUrl),
          method,
          unit,
          error: message,
        });
        if (mountedRef.current) setError(message);
      }
    },
    [manager, mintUrl, method, unit],
  );

  return { quote, isLoading, error, refresh, rotate };
}
