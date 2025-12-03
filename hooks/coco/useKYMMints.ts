import { useState, useEffect, useMemo } from 'react';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import {
  isCashuRecommendationEvent,
  extractMintUrlFromEvent,
  parseRecommendation,
  type NostrEvent,
} from 'helper/nostrClient';
import { useKYMMintStore } from 'stores/kymMintStore';

/**
 * Individual recommendation for a mint from Nostr
 */
export interface MintRecommendation {
  score: number;
  comment: string;
  pubkey: string;
  eventId: string;
  created_at: number;
}

/**
 * KYM score data for a single mint
 */
export interface KYMMintData {
  score: number;
  recommendations: MintRecommendation[];
}

interface UseKYMMintsResult {
  scores: Record<string, KYMMintData>;
  loading: boolean;
  error: string | null;
}

/**
 * Helper function to normalize URLs for comparison
 * Removes protocol (http/https), www prefix, trailing slash
 * Only lowercases the domain, preserves path case (e.g., /Bitcoin stays /Bitcoin)
 */
const normalizeUrl = (url: string): string => {
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    // No path, just domain
    return withoutProtocol
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }
  const domain = withoutProtocol
    .slice(0, slashIndex)
    .toLowerCase()
    .replace(/^www\./, '');
  const path = withoutProtocol.slice(slashIndex).replace(/\/$/, '');
  return domain + path;
};

/**
 * Hook to fetch Nostr-based rating data for multiple mint URLs in a single subscription
 *
 * @param mintUrls - Array of mint URLs to fetch rating data for
 * @returns Map of mint URLs to their scores/recommendations, loading state, and error
 */
export const useKYMMints = (mintUrls: string[]): UseKYMMintsResult => {
  const [scores, setScores] = useState<Record<string, KYMMintData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getCached = useKYMMintStore((state) => state.getCached);
  const setCached = useKYMMintStore((state) => state.setCached);
  const isStale = useKYMMintStore((state) => state.isStale);

  // Timeout fallback - if eose never fires, stop loading after 5 seconds
  useEffect(() => {
    if (!loading) return;

    const timeout = setTimeout(() => {
      setLoading(false);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [loading]);

  // Normalize mint URLs for comparison
  const normalizedMintUrls = useMemo(() => {
    return new Set(mintUrls.map((url) => normalizeUrl(url)));
  }, [mintUrls]);

  // Subscribe to ALL kind 38000 recommendation events (filter client-side)
  // This prevents filter changes from causing re-subscriptions
  const filters = useMemo(
    () => [
      {
        kinds: [38000], // Mint recommendation events
        limit: 100, // Reasonable limit
      },
    ],
    [] // Static filters - never change
  );

  const { events, eose } = useSubscribe({
    filters,
  });

  // Load cached data on mount or when mintUrls change
  useEffect(() => {
    if (normalizedMintUrls.size === 0) {
      setScores({});
      setLoading(false);
      setError(null);
      return;
    }

    // Load cached data for all requested mints
    const cachedScores: Record<string, KYMMintData> = {};
    let hasCachedData = false;

    normalizedMintUrls.forEach((normalizedUrl) => {
      const cached = getCached(normalizedUrl);
      if (cached && !isStale(normalizedUrl)) {
        cachedScores[normalizedUrl] = {
          score: cached.score,
          recommendations: cached.recommendations,
        };
        hasCachedData = true;
      }
    });

    if (hasCachedData) {
      setScores(cachedScores);
    }
  }, [normalizedMintUrls, getCached, isStale]);

  // Process events
  useEffect(() => {
    if (normalizedMintUrls.size === 0) {
      setScores({});
      setLoading(false);
      setError(null);
      return;
    }

    if (!events || events.length === 0) {
      if (eose) {
        setLoading(false);
      }
      return;
    }

    try {
      setError(null);

      // Aggregate recommendations by URL
      const recommendationsByUrl = new Map<string, MintRecommendation[]>();

      events.forEach((event: any) => {
        // Validate it's a Cashu recommendation
        if (!isCashuRecommendationEvent(event as NostrEvent)) return;

        // Extract mint URL
        const mintUrl = extractMintUrlFromEvent(event as NostrEvent);
        if (!mintUrl) return;

        const normalized = normalizeUrl(mintUrl);

        // Filter by our target mint URLs
        if (!normalizedMintUrls.has(normalized)) return;

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

      // Calculate scores for each mint
      const newScores: Record<string, KYMMintData> = {};

      normalizedMintUrls.forEach((normalizedUrl) => {
        const recommendations = recommendationsByUrl.get(normalizedUrl) || [];

        if (recommendations.length === 0) {
          // No recommendations found for this mint - check cache
          const cached = getCached(normalizedUrl);
          if (cached && !isStale(normalizedUrl)) {
            newScores[normalizedUrl] = {
              score: cached.score,
              recommendations: cached.recommendations,
            };
          }
          return;
        }

        // Calculate average score
        const totalScore = recommendations.reduce((sum, rec) => sum + rec.score, 0);
        const avgScore = Number((totalScore / recommendations.length).toFixed(2));

        newScores[normalizedUrl] = {
          score: avgScore,
          recommendations,
        };

        // Update cache with new data
        setCached(normalizedUrl, avgScore, recommendations);
      });

      // Merge with existing cached scores for mints that didn't get new events
      setScores((prevScores) => ({ ...prevScores, ...newScores }));
    } catch (err) {
      setError('Failed to process mint recommendations. Please try again.');
    } finally {
      if (eose) {
        setLoading(false);
      }
    }
  }, [events, normalizedMintUrls, eose, getCached, setCached, isStale]);

  return { scores, loading, error };
};
