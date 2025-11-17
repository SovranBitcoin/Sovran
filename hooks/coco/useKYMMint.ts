import { useState, useEffect, useMemo } from 'react';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';

/**
 * Individual recommendation for a mint from Nostr
 */
interface MintRecommendation {
  score: number;
  comment: string;
  pubkey: string;
  eventId: string;
  created_at: number;
}

interface UseKYMMintResult {
  score?: number;
  recommendations?: MintRecommendation[];
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
 * Parse rating from content string (e.g., "[5/5]" -> 5)
 */
const parseRating = (content: string): number | null => {
  const match = content.match(/\[(\d+(?:\.\d+)?)\/5\]/);
  if (!match) return null;

  const rating = parseFloat(match[1]);
  return isNaN(rating) ? null : rating;
};

/**
 * Extract mint URL from event's 'u' tag
 */
const extractMintUrl = (event: any): string | null => {
  if (!event.tags || !Array.isArray(event.tags)) return null;

  const uTag = event.tags.find((tag: any[]) => tag[0] === 'u' && tag[2] === 'cashu');
  return uTag ? uTag[1] : null;
};

/**
 * Check if event is a valid Cashu mint recommendation
 */
const isCashuRecommendation = (event: any): boolean => {
  if (event.kind !== 38000) return false;
  if (!event.tags || !Array.isArray(event.tags)) return false;

  const hasKTag = event.tags.some((tag: any[]) => tag[0] === 'k' && tag[1] === '38172');
  const hasUTag = event.tags.some((tag: any[]) => tag[0] === 'u' && tag[2] === 'cashu');

  return hasKTag && hasUTag;
};

/**
 * Hook to fetch Nostr-based rating data for a specific mint URL
 *
 * @param mintUrl - The mint URL to fetch rating data for
 * @returns Rating data including score, recommendations, loading state, and error
 */
export const useKYMMint = (mintUrl?: string): UseKYMMintResult => {
  const [score, setScore] = useState<number | undefined>();
  const [recommendations, setRecommendations] = useState<MintRecommendation[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Normalize the mint URL for comparison
  const normalizedMintUrl = useMemo(() => {
    return mintUrl ? normalizeUrl(mintUrl) : null;
  }, [mintUrl]);

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

  console.log('🔍 useKYMMint: Subscribing to Nostr with filters:', filters);

  const { events, eose } = useSubscribe({ filters });

  console.log('🔍 useKYMMint: Received events:', events?.length || 0, 'EOSE:', eose);

  // Loading state: true until we receive EOSE (end of stored events)
  useEffect(() => {
    if (eose) {
      console.log('✅ useKYMMint: EOSE received, setting loading to false');
      setLoading(false);
    }
  }, [eose]);

  // Process events
  useEffect(() => {
    console.log('🔄 useKYMMint: Processing events effect triggered');
    console.log('📊 Events count:', events?.length || 0);
    console.log('📊 Target mint URL:', normalizedMintUrl);

    if (!normalizedMintUrl) {
      console.log('⚠️ useKYMMint: No mint URL provided');
      setScore(undefined);
      setRecommendations(undefined);
      setLoading(false);
      setError(null);
      return;
    }

    if (!events || events.length === 0) {
      console.log('⚠️ useKYMMint: No events to process');
      if (eose) {
        console.log('⚠️ useKYMMint: EOSE received with no events');
        setScore(undefined);
        setRecommendations(undefined);
        setLoading(false);
      }
      return;
    }

    try {
      setError(null);

      const validRecommendations: MintRecommendation[] = [];
      let totalEventCount = 0;
      let validEventCount = 0;
      let invalidEventCount = 0;
      let wrongMintCount = 0;

      events.forEach((event: any, index: number) => {
        totalEventCount++;

        if (index < 3) {
          console.log(`🔍 Event ${index}:`, {
            id: event.id,
            kind: event.kind,
            tags: event.tags,
            content: event.content,
          });
        }

        // Validate it's a Cashu recommendation
        if (!isCashuRecommendation(event)) {
          if (index < 3) console.log(`❌ Event ${index} is not a valid Cashu recommendation`);
          invalidEventCount++;
          return;
        }

        // Extract and validate mint URL
        const eventMintUrl = extractMintUrl(event);
        if (!eventMintUrl) {
          if (index < 3) console.log(`❌ Event ${index} has no mint URL`);
          invalidEventCount++;
          return;
        }

        // Filter by our target mint URL
        const eventNormalizedUrl = normalizeUrl(eventMintUrl);
        if (eventNormalizedUrl !== normalizedMintUrl) {
          if (index < 3)
            console.log(`⏭️ Event ${index} is for different mint:`, eventNormalizedUrl);
          wrongMintCount++;
          return;
        }

        // Parse rating from content
        const rating = parseRating(event.content);
        if (rating === null) {
          if (index < 3) console.log(`❌ Event ${index} failed to parse rating:`, event.content);
          invalidEventCount++;
          return;
        }

        if (index < 3) console.log(`✅ Event ${index} parsed rating:`, rating);

        validEventCount++;
        validRecommendations.push({
          score: rating,
          comment: event.content, // Store the full content (e.g., "[5/5]")
          pubkey: event.pubkey,
          eventId: event.id,
          created_at: event.created_at,
        });
      });

      console.log('📊 useKYMMint: Processing stats:');
      console.log('  - Total events:', totalEventCount);
      console.log('  - For target mint:', validEventCount);
      console.log('  - For other mints:', wrongMintCount);
      console.log('  - Invalid events:', invalidEventCount);

      if (validRecommendations.length === 0) {
        console.log('⚠️ useKYMMint: No valid recommendations found for this mint');
        setScore(undefined);
        setRecommendations(undefined);
        return;
      }

      // Calculate average score
      const totalScore = validRecommendations.reduce((sum, rec) => sum + rec.score, 0);
      const avgScore = Number((totalScore / validRecommendations.length).toFixed(2));

      console.log(
        '✅ useKYMMint: Calculated average score:',
        avgScore,
        'from',
        validRecommendations.length,
        'recommendations'
      );

      setScore(avgScore);
      setRecommendations(validRecommendations);
    } catch (err) {
      console.error('❌ useKYMMint: Failed to process Nostr events:', err);
      setError('Failed to process mint recommendations. Please try again.');
      setScore(undefined);
      setRecommendations(undefined);
    }
  }, [events, normalizedMintUrl, eose]);

  console.log('📊 useKYMMint: Current state:', {
    mintUrl: normalizedMintUrl,
    score,
    recommendationsCount: recommendations?.length || 0,
    loading,
    error,
  });

  return { score, recommendations, loading, error };
};
