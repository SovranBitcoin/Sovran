import { useState, useEffect, useRef, useMemo } from 'react';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { fetchMintInfo } from 'helper/apiClient';
import type { GetInfoResponse } from '@cashu/cashu-ts';
import {
  isCashuRecommendationEvent,
  extractMintUrlFromEvent,
  parseRecommendation,
  type NostrEvent,
} from 'helper/nostrClient';
import { useMintManagement } from './useMintManagement';

/**
 * Individual recommendation for a mint
 */
export interface MintRecommendation {
  score: number;
  comment: string;
  pubkey: string;
  eventId: string;
  created_at: number;
}

/**
 * Data structure for Nostr-discovered mints (aggregated)
 */
export interface NostrDiscoveredMintData {
  url: string;
  score: number; // Average score from all recommendations
  recommendations: MintRecommendation[]; // All individual recommendations
  mintInfo: GetInfoResponse | null;
}

interface UseNostrDiscoveredMintsResult {
  mints: NostrDiscoveredMintData[];
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Helper function to normalize URLs for comparison (remove trailing slash)
 */
const normalizeUrl = (url: string): string => {
  return url.replace(/\/$/, '');
};

/**
 * Hook for discovering mints via Nostr kind 38000 recommendation events
 * Uses parallel async processing pattern for efficient incremental updates
 */
export const useNostrDiscoveredMints = (): UseNostrDiscoveredMintsResult => {
  const [mints, setMints] = useState<NostrDiscoveredMintData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const processedUrls = useRef(new Set<string>());

  // Get known mints for blacklist
  const { mints: knownMints } = useMintManagement();

  // Subscribe to kind 38000 recommendation events
  const filters = useMemo(
    () => [
      {
        kinds: [38000], // Mint recommendation events
        limit: 100,
      },
    ],
    []
  );

  const { events, eose } = useSubscribe({ filters });

  // Loading state: true until we receive EOSE (end of stored events)
  useEffect(() => {
    if (eose) {
      setLoading(false);
    }
  }, [eose]);

  // Process events using parallel async pattern
  useEffect(() => {
    if (!events || events.length === 0) {
      if (eose) {
        setLoading(false);
      }
      return;
    }

    try {
      setError(null);

      // Get known mint URLs for blacklist (normalized)
      const knownMintUrls = new Set(knownMints.map((mint) => normalizeUrl(mint.mintUrl)));

      // Aggregate recommendations by URL
      const recommendationsByUrl = new Map<string, MintRecommendation[]>();

      events.forEach((event: any) => {
        // Validate it's a Cashu recommendation
        if (!isCashuRecommendationEvent(event as NostrEvent)) return;

        // Extract mint URL
        const mintUrl = extractMintUrlFromEvent(event as NostrEvent);
        if (!mintUrl) return;

        const normalized = normalizeUrl(mintUrl);

        // Skip blacklisted (known mints)
        if (knownMintUrls.has(normalized)) return;

        // Parse recommendation
        const recommendation = parseRecommendation(event.content);
        if (!recommendation) return;

        // Aggregate recommendations by URL
        const existingRecommendations = recommendationsByUrl.get(normalized) || [];
        existingRecommendations.push({
          score: recommendation.score,
          comment: recommendation.comment,
          pubkey: event.pubkey,
          eventId: event.id,
          created_at: event.created_at,
        });
        recommendationsByUrl.set(normalized, existingRecommendations);
      });

      // Single pass: find new URLs to process
      const urlsToProcess: string[] = [];

      recommendationsByUrl.forEach((recommendations, url) => {
        // Skip if already processed
        if (processedUrls.current.has(url)) return;

        // Mark as processed immediately
        processedUrls.current.add(url);

        // Collect for processing
        urlsToProcess.push(url);
      });

      if (urlsToProcess.length === 0) return;

      // Process all URLs in parallel, updating state incrementally as each completes
      urlsToProcess.forEach(async (url) => {
        try {
          const recommendations = recommendationsByUrl.get(url)!;

          // Calculate average score
          const sumScore = recommendations.reduce((sum, r) => sum + r.score, 0);
          const avgScore = Number((sumScore / recommendations.length).toFixed(2));

          const mintInfoResult = await fetchMintInfo(url);
          const result: NostrDiscoveredMintData = {
            url,
            score: avgScore,
            recommendations,
            mintInfo: mintInfoResult.isOk() ? mintInfoResult.value : null,
          };

          // Update state immediately as this mint completes
          setMints((prev) => {
            // Avoid duplicates (in case of race conditions)
            const existingUrls = new Set(prev.map((m) => m.url));
            if (existingUrls.has(result.url)) return prev;
            return [...prev, result];
          });
        } catch {
          const recommendations = recommendationsByUrl.get(url)!;
          const sumScore = recommendations.reduce((sum, r) => sum + r.score, 0);
          const avgScore = Number((sumScore / recommendations.length).toFixed(2));

          const result: NostrDiscoveredMintData = {
            url,
            score: avgScore,
            recommendations,
            mintInfo: null,
          };

          // Update state even for failed fetches (with null mintInfo)
          setMints((prev) => {
            const existingUrls = new Set(prev.map((m) => m.url));
            if (existingUrls.has(result.url)) return prev;
            return [...prev, result];
          });
        }
      });
    } catch {
      setError('Failed to process mint recommendations. Please try again.');
    }
  }, [events, knownMints, eose]);

  // Reset on retry
  useEffect(() => {
    if (retryCount > 0) {
      setMints([]);
      setError(null);
      setLoading(true);
      processedUrls.current.clear();
    }
  }, [retryCount]);

  const retry = () => {
    setRetryCount((prev) => prev + 1);
  };

  return { mints, loading, error, retry };
};
