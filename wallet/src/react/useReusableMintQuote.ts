import { useCallback, useEffect, useRef, useState } from "react";
import type { Manager } from "@cashu/coco-core";

import { logger, mintUrlFields } from "../logger";
import {
  ensureReusableMintQuote,
  type EnsureReusableMintQuoteInput,
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
}

/**
 * React binding for the reusable-quote singleton: resolves the ONE standing
 * bolt12 offer / onchain address for (mint, method, unit) and re-reads on
 * `mint-quote:updated` so paid/issued totals and expiry stay fresh without
 * the QR churning.
 */
export function useReusableMintQuote(
  input: EnsureReusableMintQuoteInput | null,
): UseReusableMintQuoteResult {
  const manager = useColadaManager();
  const [quote, setQuote] = useState<ReusableMintQuote | null>(null);
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
    setIsLoading(true);
    setError(null);
    (async () => {
      try {
        const resolved = await ensureReusableMintQuote(manager, {
          mintUrl,
          method,
          unit,
        });
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
  // live in quoteData) without recreating it.
  useEffect(() => {
    if (!mintUrl) return;
    const onQuoteUpdated = (payload: { mintUrl: string; quoteId: string }) => {
      if (payload.mintUrl !== mintUrl) return;
      setQuote((current) => current);
      setGeneration((g) => g + 1);
    };
    manager.on("mint-quote:updated", onQuoteUpdated);
    return () => manager.off("mint-quote:updated", onQuoteUpdated);
  }, [manager, mintUrl]);

  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  return { quote, isLoading, error, refresh };
}
