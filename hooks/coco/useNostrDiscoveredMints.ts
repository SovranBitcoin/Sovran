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

  console.log('🔍 useNostrDiscoveredMints: Subscribing to Nostr with filters:', filters);

  const { events, eose } = useSubscribe({ filters });

  console.log('🔍 useNostrDiscoveredMints: Events:', JSON.stringify(events, null, 2));

  console.log('🔍 useNostrDiscoveredMints: Received events:', events?.length || 0, 'EOSE:', eose);

  // Loading state: true until we receive EOSE (end of stored events)
  useEffect(() => {
    if (eose) {
      console.log('✅ useNostrDiscoveredMints: EOSE received, setting loading to false');
      setLoading(false);
    }
  }, [eose]);

  // Process events using parallel async pattern
  useEffect(() => {
    console.log('🔄 useNostrDiscoveredMints: Processing events effect triggered');
    console.log('📊 Events count:', events?.length || 0);
    console.log('📊 Known mints count:', knownMints.length);

    if (!events || events.length === 0) {
      console.log('⚠️ useNostrDiscoveredMints: No events to process');
      if (eose) {
        console.log('⚠️ useNostrDiscoveredMints: EOSE received with no events');
        setLoading(false);
      }
      return;
    }

    try {
      setError(null);

      // Get known mint URLs for blacklist (normalized)
      const knownMintUrls = new Set(knownMints.map((mint) => normalizeUrl(mint.mintUrl)));
      console.log(
        '🚫 useNostrDiscoveredMints: Known mint URLs (blacklist):',
        Array.from(knownMintUrls)
      );

      // Aggregate recommendations by URL
      const recommendationsByUrl = new Map<string, MintRecommendation[]>();

      let cashuEventCount = 0;
      let extractedUrlCount = 0;
      let blacklistedCount = 0;
      let failedParseCount = 0;

      events.forEach((event: any, index: number) => {
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
        if (index < 3) console.log(`✅ Event ${index} mint URL:`, mintUrl);

        const normalized = normalizeUrl(mintUrl);

        // Skip blacklisted (known mints)
        if (knownMintUrls.has(normalized)) {
          blacklistedCount++;
          if (index < 3) console.log(`🚫 Event ${index} is blacklisted (known mint):`, normalized);
          return;
        }

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

      console.log('📊 useNostrDiscoveredMints: Processing stats:');
      console.log('  - Total events:', events.length);
      console.log('  - Cashu events:', cashuEventCount);
      console.log('  - With URLs:', extractedUrlCount);
      console.log('  - Blacklisted:', blacklistedCount);
      console.log('  - Failed to parse:', failedParseCount);
      console.log('  - Unique mints:', recommendationsByUrl.size);

      // Single pass: find new URLs to process
      const urlsToProcess: string[] = [];

      recommendationsByUrl.forEach((recommendations, url) => {
        // Skip if already processed
        if (processedUrls.current.has(url)) {
          console.log(`⏭️  Skipping already processed: ${url}`);
          return;
        }

        // Mark as processed immediately
        processedUrls.current.add(url);
        console.log(`✔️  Marked as processed: ${url} (${recommendations.length} recommendations)`);

        // Collect for processing
        urlsToProcess.push(url);
      });

      console.log('📊 URLs to process:', urlsToProcess.length);

      if (urlsToProcess.length === 0) {
        console.log('⚠️ useNostrDiscoveredMints: No URLs to process after filtering');
        return;
      }

      console.log('🔄 useNostrDiscoveredMints: Processing', urlsToProcess.length, 'URLs...');

      // Process all URLs in parallel, updating state incrementally as each completes
      urlsToProcess.forEach(async (url, index) => {
        try {
          const recommendations = recommendationsByUrl.get(url)!;

          // Calculate average score
          const sumScore = recommendations.reduce((sum, r) => sum + r.score, 0);
          const avgScore = Number((sumScore / recommendations.length).toFixed(2));

          console.log(
            `🔄 Fetching mint info ${index + 1}/${urlsToProcess.length}:`,
            url,
            `(${recommendations.length} recommendations, avg score: ${avgScore})`
          );

          const mintInfoResult = await fetchMintInfo(url);
          const result: NostrDiscoveredMintData = {
            url,
            score: avgScore,
            recommendations,
            mintInfo: mintInfoResult.isOk() ? mintInfoResult.value : null,
          };

          console.log(`✅ Fetched mint info ${index + 1}/${urlsToProcess.length}:`, {
            url,
            hasInfo: mintInfoResult.isOk(),
            name: result.mintInfo?.name,
            recommendationCount: recommendations.length,
            avgScore,
          });

          // Update state immediately as this mint completes
          setMints((prev) => {
            // Avoid duplicates (in case of race conditions)
            const existingUrls = new Set(prev.map((m) => m.url));
            if (existingUrls.has(result.url)) {
              console.log('⏭️  Skipping duplicate mint:', result.url);
              return prev;
            }
            console.log('➕ Adding mint to state:', result.url);
            return [...prev, result];
          });
        } catch (err) {
          const recommendations = recommendationsByUrl.get(url)!;
          const sumScore = recommendations.reduce((sum, r) => sum + r.score, 0);
          const avgScore = Number((sumScore / recommendations.length).toFixed(2));

          console.warn(`⚠️ Failed to fetch mint info for ${url}:`, err);

          const result: NostrDiscoveredMintData = {
            url,
            score: avgScore,
            recommendations,
            mintInfo: null,
          };

          // Update state even for failed fetches (with null mintInfo)
          setMints((prev) => {
            const existingUrls = new Set(prev.map((m) => m.url));
            if (existingUrls.has(result.url)) {
              console.log('⏭️  Skipping duplicate mint:', result.url);
              return prev;
            }
            console.log('➕ Adding mint to state (failed fetch):', result.url);
            return [...prev, result];
          });
        }
      });
    } catch (err) {
      console.error('❌ useNostrDiscoveredMints: Failed to process Nostr events:', err);
      setError('Failed to process mint recommendations. Please try again.');
    }
  }, [events, knownMints, eose]);

  // Reset on retry
  useEffect(() => {
    if (retryCount > 0) {
      console.log('🔄 useNostrDiscoveredMints: Retrying...');
      setMints([]);
      setError(null);
      setLoading(true);
      processedUrls.current.clear();
    }
  }, [retryCount]);

  const retry = () => {
    console.log('🔄 useNostrDiscoveredMints: Retry requested');
    setRetryCount((prev) => prev + 1);
  };

  console.log('📊 useNostrDiscoveredMints: Current state:', {
    mintsCount: mints.length,
    loading,
    error,
    processedUrlsCount: processedUrls.current.size,
  });

  return { mints, loading, error, retry };
};
