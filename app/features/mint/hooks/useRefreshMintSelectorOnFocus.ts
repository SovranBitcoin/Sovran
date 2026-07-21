import { useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { normalizeMintUrl } from '@cashu/coco-core';
import { Result, ResultAsync } from 'neverthrow';

import { cashuLog, redactError } from '@/shared/lib/logger';

const normalizeMintUrlSet = Result.fromThrowable(
  (urls: readonly string[]) => new Set(urls.map(normalizeMintUrl)),
  () => 'invalid_mint_url' as const
);

function mintUrlSetFingerprint(urls: readonly string[]): string | null {
  return normalizeMintUrlSet(urls).match(
    (normalized) => JSON.stringify([...normalized].sort()),
    () => null
  );
}

/** True when the machine selector was built from a different trusted-mint set. */
export function mintSelectorCandidateSetIsStale(
  trustedMintUrls: readonly string[],
  candidateMintUrls: readonly string[]
): boolean {
  const trustedResult = normalizeMintUrlSet(trustedMintUrls);
  const candidateResult = normalizeMintUrlSet(candidateMintUrls);
  if (trustedResult.isErr() || candidateResult.isErr()) return true;
  const trusted = trustedResult.value;
  const candidates = candidateResult.value;
  if (trusted.size !== candidates.size) return true;
  return [...trusted].some((url) => !candidates.has(url));
}

/**
 * Rebuild a management selector from the machine's current WalletContext after
 * returning from Add Mint. This keeps machine-derived units, capabilities,
 * balances, ordering, and enrichment authoritative instead of merging stale
 * route-entry rows into the live list.
 */
export function useRefreshMintSelectorOnFocus({
  enabled,
  flow,
  trustedMintUrls,
  candidateMintUrls,
  refresh,
}: {
  enabled: boolean;
  flow: 'send' | 'receive';
  trustedMintUrls: readonly string[];
  candidateMintUrls: readonly string[];
  refresh: () => Promise<void>;
}): void {
  const lastAttemptRef = useRef<string | null>(null);
  const trustedFingerprint = useMemo(
    () => mintUrlSetFingerprint(trustedMintUrls),
    [trustedMintUrls]
  );
  const candidateFingerprint = useMemo(
    () => mintUrlSetFingerprint(candidateMintUrls),
    [candidateMintUrls]
  );
  const trustedMintCount = useMemo(
    () =>
      normalizeMintUrlSet(trustedMintUrls)
        .map((urls) => urls.size)
        .unwrapOr(0),
    [trustedMintUrls]
  );
  const candidateMintCount = useMemo(
    () =>
      normalizeMintUrlSet(candidateMintUrls)
        .map((urls) => urls.size)
        .unwrapOr(0),
    [candidateMintUrls]
  );
  const runRefresh = useMemo(
    () =>
      ResultAsync.fromThrowable(refresh, (cause) => ({
        type: 'MintSelectorRefreshError' as const,
        cause,
      })),
    [refresh]
  );

  useFocusEffect(
    useCallback(() => {
      const invalidUrlSet = trustedFingerprint === null || candidateFingerprint === null;
      if (!enabled || (!invalidUrlSet && trustedFingerprint === candidateFingerprint)) {
        lastAttemptRef.current = null;
        return;
      }

      const attempt = `${trustedFingerprint ?? 'invalid'}:${candidateFingerprint ?? 'invalid'}`;
      if (lastAttemptRef.current === attempt) return;
      lastAttemptRef.current = attempt;

      cashuLog.info('mint.selector.refresh_on_focus', {
        flow,
        trustedMintCount,
        candidateMintCount,
        invalidUrlSet,
      });
      void runRefresh().match(
        () => undefined,
        ({ cause }) => {
          if (lastAttemptRef.current === attempt) lastAttemptRef.current = null;
          cashuLog.warn('mint.selector.refresh_on_focus.failed', {
            flow,
            error: redactError(cause),
          });
        }
      );

      return () => {
        if (lastAttemptRef.current === attempt) lastAttemptRef.current = null;
      };
    }, [
      candidateFingerprint,
      candidateMintCount,
      enabled,
      flow,
      runRefresh,
      trustedFingerprint,
      trustedMintCount,
    ])
  );
}
