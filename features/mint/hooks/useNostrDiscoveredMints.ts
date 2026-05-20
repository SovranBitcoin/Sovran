import { useState, useEffect, useRef, useMemo } from 'react';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { fetchMintInfo } from '@/shared/lib/apiClient';
import { cashuLog } from '@/shared/lib/logger';
import {
  isCashuRecommendationEvent,
  extractMintUrlFromEvent,
  parseRecommendation,
  type NostrEvent,
} from '@/shared/lib/nostr/client';
import { normalizeMintUrlKey, normalizeUrlForApi } from '@/shared/lib/url';

import type { MintRecommendation } from '@/shared/lib/apiClient';
import { useMintManagement } from './useMintManagement';

interface NostrDiscoveredMintData {
  url: string;
  score: number;
  recommendations: MintRecommendation[];
  mintInfo: GetInfoResponse | null;
}

interface UseNostrDiscoveredMintsResult {
  mints: NostrDiscoveredMintData[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Appends a mint to state if not already present (by normalized URL).
 * Shared by the parallel per-URL fetch callbacks to avoid race-condition duplicates.
 */
function appendMintIfNew(
  setter: React.Dispatch<React.SetStateAction<NostrDiscoveredMintData[]>>,
  result: NostrDiscoveredMintData
) {
  setter((prev) => {
    const existingUrls = new Set(prev.map((m) => m.url));
    if (existingUrls.has(result.url)) return prev;
    return [...prev, result];
  });
}

/** Calculates average score from a list of recommendations */
function averageScore(recommendations: MintRecommendation[]): number {
  const sum = recommendations.reduce((acc, r) => acc + r.score, 0);
  return Number((sum / recommendations.length).toFixed(2));
}

/**
 * Discovers mints via Nostr kind 38000 recommendation events.
 * Uses nostrClient helpers for event parsing and normalizeMintUrlKey for URL dedup.
 */
export const useNostrDiscoveredMints = (): UseNostrDiscoveredMintsResult => {
  const [mints, setMints] = useState<NostrDiscoveredMintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const processedUrls = useRef(new Set<string>());

  const { mints: knownMints } = useMintManagement();

  const filters = useMemo(() => [{ kinds: [38000], limit: 100 }], []);
  const { events, eose } = useSubscribe({ filters });

  useEffect(() => {
    if (eose) setLoading(false);
  }, [eose]);

  useEffect(() => {
    if (!events || events.length === 0) {
      if (eose) setLoading(false);
      return;
    }

    const controller = new AbortController();
    try {
      setError(null);

      const knownMintUrls = new Set(knownMints.map((mint) => normalizeMintUrlKey(mint.mintUrl)));

      // Map normalized key → { fullUrl, recommendations }
      const recommendationsByKey = new Map<
        string,
        { fullUrl: string; recs: MintRecommendation[] }
      >();

      events.forEach((event) => {
        if (!isCashuRecommendationEvent(event as NostrEvent)) return;
        const mintUrl = extractMintUrlFromEvent(event as NostrEvent);
        if (!mintUrl) return;

        const key = normalizeMintUrlKey(mintUrl);
        if (knownMintUrls.has(key)) return;

        const recommendation = parseRecommendation(event.content);
        if (!recommendation) return;

        // NDKEvent.created_at is optional; MintRecommendation requires it.
        // Drop events without one rather than coerce to 0/Date.now() —
        // they'd misorder downstream sort-by-recency.
        if (typeof event.created_at !== 'number') return;

        const entry = recommendationsByKey.get(key) ?? {
          fullUrl: normalizeUrlForApi(mintUrl),
          recs: [],
        };
        entry.recs.push({
          score: recommendation.score,
          comment: recommendation.comment,
          pubkey: event.pubkey,
          eventId: event.id,
          created_at: event.created_at,
        });
        recommendationsByKey.set(key, entry);
      });

      const urlsToProcess: { key: string; fullUrl: string; recs: MintRecommendation[] }[] = [];
      recommendationsByKey.forEach((entry, key) => {
        if (processedUrls.current.has(key)) return;
        processedUrls.current.add(key);
        urlsToProcess.push({ key, ...entry });
      });

      if (urlsToProcess.length === 0) return;

      cashuLog.info('mint.nostr.discovered', {
        newUrls: urlsToProcess.length,
        totalProcessed: processedUrls.current.size,
      });
      urlsToProcess.forEach(async ({ fullUrl: url, recs: recommendations }) => {
        const score = averageScore(recommendations);

        try {
          const mintInfoResult = await fetchMintInfo(url, { signal: controller.signal });
          if (controller.signal.aborted) return;
          const info = mintInfoResult.isOk() ? mintInfoResult.value : null;
          cashuLog.debug('mint.nostr.info.resolved', {
            url,
            hasInfo: !!info,
            hasIcon: !!info?.icon_url,
            name: info?.name,
          });
          appendMintIfNew(setMints, {
            url,
            score,
            recommendations,
            mintInfo: info,
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          cashuLog.warn('mint.nostr.info.error', {
            url,
            error: err instanceof Error ? err : new Error(String(err)),
          });
          appendMintIfNew(setMints, { url, score, recommendations, mintInfo: null });
        }
      });
    } catch (err) {
      cashuLog.error('mint.nostr.error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      setError('Failed to process mint recommendations. Please try again.');
    }
    return () => controller.abort();
  }, [events, knownMints, eose]);

  useEffect(() => {
    if (retryCount > 0) {
      cashuLog.info('mint.nostr.retry', { retryCount });
      setMints([]);
      setError(null);
      setLoading(true);
      processedUrls.current.clear();
    }
  }, [retryCount]);

  const retry = () => setRetryCount((prev) => prev + 1);

  return { mints, loading, error, retry };
};
