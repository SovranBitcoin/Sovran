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
import { useLatestRef } from "./useLatestRef";

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
 * One get-or-create against the identity store, reported as a tagged result.
 * Module scope on purpose: the React Compiler cannot lower a `try` that has a
 * `finally`, or one whose body holds a ternary, so leaving this inline in the
 * effect is what made the hook uncompilable. Nothing here touches React.
 */
async function resolveReusableQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
  identityStore: ReusableQuoteIdentityStore,
): Promise<
  { ok: true; quote: ReusableMintQuote } | { ok: false; message: string }
> {
  try {
    const quote = await ensureReusableMintQuote(manager, input, identityStore);
    return { ok: true, quote };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("quotes.reusable.ensure_failed", {
      ...mintUrlFields(input.mintUrl),
      method: input.method,
      unit: input.unit,
      error: message,
    });
    return { ok: false, message };
  }
}

/**
 * The rotate half of the same story: retire the standing quote and record its
 * replacement. Module scope for the same reason as `resolveReusableQuote`.
 */
async function rotateReusableQuote(
  manager: Manager,
  input: EnsureReusableMintQuoteInput,
  identityStore: ReusableQuoteIdentityStore,
  reason: "manual" | "deposit_received",
): Promise<
  { ok: true; quote: ReusableMintQuote } | { ok: false; message: string }
> {
  try {
    const quote = await rotateReusableMintQuote(
      manager,
      input,
      identityStore,
      reason,
    );
    return { ok: true, quote };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("quotes.reusable.rotate_failed", {
      ...mintUrlFields(input.mintUrl),
      method: input.method,
      unit: input.unit,
      error: message,
    });
    return { ok: false, message };
  }
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

  // Both written in useInsertionEffect rather than in render: a ref write in
  // the render body switches the React Compiler off for the whole hook. Every
  // read happens from an effect or a coco event handler, both of which run
  // after insertion effects, so they still see the committed render's values.
  const identityStoreRef = useLatestRef(identityStore);
  const quoteIdRef = useLatestRef<string | null>(quote?.quoteId ?? null);

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
    void (async () => {
      const outcome = await resolveReusableQuote(
        manager,
        { mintUrl, method, unit },
        identityStoreRef.current,
      );
      if (cancelled || !mountedRef.current) return;
      if (outcome.ok) setQuote(outcome.quote);
      else setError(outcome.message);
      setIsLoading(false);
    })().catch(() => {
      // Restores the guarantee the old `try/finally` gave: whatever went wrong
      // after the wallet call — including a logger that threw — the field must
      // stop showing a spinner. `finally` itself cannot come back; the React
      // Compiler refuses to lower it and the hook would stop compiling.
      if (!cancelled && mountedRef.current) setIsLoading(false);
    });
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

  // The dep list names the refs too. It used to read
  // `[manager, mintUrl, method, unit]` while the body also reached
  // `identityStoreRef`/`mountedRef`, and a memo the compiler cannot preserve
  // switches it off for the whole hook. It stays an explicit useCallback so
  // `rotate`'s identity is stable for consumers even where the compiler is
  // not running (Jest), not only once compiled.
  const rotate = useCallback(
    async (reason: "manual" | "deposit_received" = "manual") => {
      if (!mintUrl || !method || !unit) return;
      const outcome = await rotateReusableQuote(
        manager,
        { mintUrl, method, unit },
        identityStoreRef.current,
        reason,
      );
      if (!mountedRef.current) return;
      if (outcome.ok) setQuote(outcome.quote);
      else setError(outcome.message);
    },
    [manager, mintUrl, method, unit, identityStoreRef, mountedRef],
  );

  return { quote, isLoading, error, refresh, rotate };
}
