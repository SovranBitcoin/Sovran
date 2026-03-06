import { useState, useEffect, useRef, useMemo } from 'react';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { fetchMintInfo } from '@/shared/lib/apiClient';
import {
  isCashuRecommendationEvent,
  extractMintUrlFromEvent,
  parseRecommendation,
  type NostrEvent,
} from '@/shared/lib/nostr/client';
import { normalizeMintUrlKey } from '@/shared/lib/url';

import type { MintRecommendation } from './useKYMMints';
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

    try {
      setError(null);

      const knownMintUrls = new Set(knownMints.map((mint) => normalizeMintUrlKey(mint.mintUrl)));

      const recommendationsByUrl = new Map<string, MintRecommendation[]>();

      events.forEach((event: any) => {
        if (!isCashuRecommendationEvent(event as NostrEvent)) return;
        const mintUrl = extractMintUrlFromEvent(event as NostrEvent);
        if (!mintUrl) return;

        const normalized = normalizeMintUrlKey(mintUrl);
        if (knownMintUrls.has(normalized)) return;

        const recommendation = parseRecommendation(event.content);
        if (!recommendation) return;

        const existing = recommendationsByUrl.get(normalized) || [];
        existing.push({
          score: recommendation.score,
          comment: recommendation.comment,
          pubkey: event.pubkey,
          eventId: event.id,
          created_at: event.created_at,
        });
        recommendationsByUrl.set(normalized, existing);
      });

      const urlsToProcess: string[] = [];
      recommendationsByUrl.forEach((_recs, url) => {
        if (processedUrls.current.has(url)) return;
        processedUrls.current.add(url);
        urlsToProcess.push(url);
      });

      if (urlsToProcess.length === 0) return;

      urlsToProcess.forEach(async (url) => {
        const recommendations = recommendationsByUrl.get(url)!;
        const score = averageScore(recommendations);

        try {
          const mintInfoResult = await fetchMintInfo(url);
          appendMintIfNew(setMints, {
            url,
            score,
            recommendations,
            mintInfo: mintInfoResult.isOk() ? mintInfoResult.value : null,
          });
        } catch {
          appendMintIfNew(setMints, { url, score, recommendations, mintInfo: null });
        }
      });
    } catch {
      setError('Failed to process mint recommendations. Please try again.');
    }
  }, [events, knownMints, eose]);

  useEffect(() => {
    if (retryCount > 0) {
      setMints([]);
      setError(null);
      setLoading(true);
      processedUrls.current.clear();
    }
  }, [retryCount]);

  const retry = () => setRetryCount((prev) => prev + 1);

  return { mints, loading, error, retry };
};
