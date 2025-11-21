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
 * Helper function to normalize URLs for comparison (remove trailing slash)
 */
const normalizeUrl = (url: string): string => {
  return url.replace(/\/$/, '');
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

  console.log('🔍 useKYMMints: Received events:', events?.length || 0, 'EOSE:', eose);

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
      console.log(
        '📦 useKYMMints: Loaded cached scores for',
        Object.keys(cachedScores).length,
        'mints'
      );
      setScores(cachedScores);
      // Still set loading to false only after EOSE, but we have cached data to show
    }
  }, [normalizedMintUrls, getCached, isStale]);

  // Process events
  useEffect(() => {
    console.log('🔄 useKYMMints: Processing events effect triggered');
    console.log('📊 Events count:', events?.length || 0);
    console.log('📊 Target mint URLs count:', normalizedMintUrls.size);

    if (normalizedMintUrls.size === 0) {
      console.log('⚠️ useKYMMints: No mint URLs provided');
      setScores({});
      setLoading(false);
      setError(null);
      return;
    }

    if (!events || events.length === 0) {
      console.log('⚠️ useKYMMints: No events to process');
      if (eose) {
        console.log('⚠️ useKYMMints: EOSE received with no events');
        // Keep any cached data that was loaded, just set loading to false
        setLoading(false);
      }
      return;
    }

    try {
      setError(null);

      // Aggregate recommendations by URL
      const recommendationsByUrl = new Map<string, MintRecommendation[]>();

      let totalEventCount = 0;
      let cashuEventCount = 0;
      let extractedUrlCount = 0;
      let targetMintCount = 0;
      let failedParseCount = 0;

      events.forEach((event: any, index: number) => {
        totalEventCount++;

        if (index < 3) {
          console.log(`🔍 Event ${index}:`, {
            id: event.id,
            kind: event.kind,
            tags: event.tags,
            content: event.content?.substring(0, 100),
          });
        }

        // Validate it's a Cashu recommendation
        const isCashu = isCashuRecommendationEvent(event as NostrEvent);
        if (!isCashu) {
          if (index < 3) console.log(`❌ Event ${index} is not a Cashu recommendation`);
          return;
        }
        cashuEventCount++;

        // Extract mint URL
        const mintUrl = extractMintUrlFromEvent(event as NostrEvent);
        if (!mintUrl) {
          if (index < 3) console.log(`❌ Event ${index} has no mint URL`);
          return;
        }
        extractedUrlCount++;

        const normalized = normalizeUrl(mintUrl);

        // Filter by our target mint URLs
        if (!normalizedMintUrls.has(normalized)) {
          if (index < 3) console.log(`⏭️ Event ${index} is for different mint:`, normalized);
          return;
        }
        targetMintCount++;

        // Parse recommendation
        const recommendation = parseRecommendation(event.content);
        if (!recommendation) {
          failedParseCount++;
          if (index < 3)
            console.log(`❌ Event ${index} failed to parse recommendation:`, event.content);
          return;
        }
        if (index < 3) console.log(`✅ Event ${index} parsed recommendation:`, recommendation);

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

      console.log('📊 useKYMMints: Processing stats:');
      console.log('  - Total events:', totalEventCount);
      console.log('  - Cashu events:', cashuEventCount);
      console.log('  - With URLs:', extractedUrlCount);
      console.log('  - For target mints:', targetMintCount);
      console.log('  - Failed to parse:', failedParseCount);
      console.log('  - Unique mints with recommendations:', recommendationsByUrl.size);

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
        console.log(`💾 Cached KYM score for ${normalizedUrl}`);
      });

      console.log('✅ useKYMMints: Calculated scores for', Object.keys(newScores).length, 'mints');

      // Merge with existing cached scores for mints that didn't get new events
      setScores((prevScores) => ({ ...prevScores, ...newScores }));
    } catch (err) {
      console.error('❌ useKYMMints: Failed to process Nostr events:', err);
      setError('Failed to process mint recommendations. Please try again.');
      // Don't clear scores on error - keep cached data if available
      setScores((prevScores) => {
        // Only clear if we have no cached data
        if (Object.keys(prevScores).length === 0) {
          return {};
        }
        return prevScores;
      });
    } finally {
      if (eose) {
        setLoading(false);
      }
    }
  }, [events, normalizedMintUrls, eose, getCached, setCached, isStale]);

  console.log('📊 useKYMMints: Current state:', {
    mintUrlsCount: normalizedMintUrls.size,
    scoresCount: Object.keys(scores).length,
    loading,
    error,
  });

  return { scores, loading, error };
};
