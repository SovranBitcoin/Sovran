import { useState, useEffect, useMemo } from 'react';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';

import { cashuLog } from '@/shared/lib/logger';
import {
  isCashuRecommendationEvent,
  extractMintUrlFromEvent,
  parseRecommendation,
  type NostrEvent,
} from '@/shared/lib/nostr/client';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';

import type { MintRecommendation } from './useKYMMints';

interface UseKYMMintResult {
  score?: number;
  recommendations?: MintRecommendation[];
  loading: boolean;
  error: string | null;
}

/**
 * Fetches Nostr-based KYM rating data for a single mint URL.
 * Subscribes to kind 38000 events, filters client-side for the target mint,
 * and caches results via useKYMMintStore.
 */
export const useKYMMint = (mintUrl?: string): UseKYMMintResult => {
  const [score, setScore] = useState<number | undefined>();
  const [recommendations, setRecommendations] = useState<MintRecommendation[] | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getCached = useKYMMintStore((state) => state.getCached);
  const setCached = useKYMMintStore((state) => state.setCached);
  const isStale = useKYMMintStore((state) => state.isStale);

  const normalizedMintUrl = useMemo(() => {
    return mintUrl ? normalizeMintUrlKey(mintUrl) : null;
  }, [mintUrl]);

  const filters = useMemo(() => [{ kinds: [38000], limit: 100 }], []);
  const { events, eose } = useSubscribe({ filters });

  // Load cached data on mount or when mintUrl changes
  useEffect(() => {
    if (!normalizedMintUrl) {
      setScore(undefined);
      setRecommendations(undefined);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = getCached(normalizedMintUrl);
    if (cached && !isStale(normalizedMintUrl)) {
      cashuLog.debug('mint.kym.cache.hit', { mintUrl: normalizedMintUrl, score: cached.score, recommendations: cached.recommendations.length });
      setScore(cached.score);
      setRecommendations(cached.recommendations);
    } else {
      cashuLog.debug('mint.kym.cache.miss', { mintUrl: normalizedMintUrl });
    }
  }, [normalizedMintUrl, getCached, isStale]);

  useEffect(() => {
    if (eose) setLoading(false);
  }, [eose]);

  // Process events — filter for target mint, aggregate, and calculate average score
  useEffect(() => {
    if (!normalizedMintUrl) {
      setScore(undefined);
      setRecommendations(undefined);
      setLoading(false);
      setError(null);
      return;
    }

    if (!events || events.length === 0) {
      if (eose) setLoading(false);
      return;
    }

    try {
      setError(null);

      const validRecommendations: MintRecommendation[] = [];

      events.forEach((event: any) => {
        if (!isCashuRecommendationEvent(event as NostrEvent)) return;

        const eventMintUrl = extractMintUrlFromEvent(event as NostrEvent);
        if (!eventMintUrl) return;

        if (normalizeMintUrlKey(eventMintUrl) !== normalizedMintUrl) return;

        const parsed = parseRecommendation(event.content);
        if (!parsed) return;

        validRecommendations.push({
          score: parsed.score,
          comment: parsed.comment,
          pubkey: event.pubkey,
          eventId: event.id,
          created_at: event.created_at,
        });
      });

      if (validRecommendations.length === 0) {
        const cached = getCached(normalizedMintUrl);
        if (cached && !isStale(normalizedMintUrl)) {
          setScore(cached.score);
          setRecommendations(cached.recommendations);
        } else {
          setScore(undefined);
          setRecommendations(undefined);
        }
        return;
      }

      const totalScore = validRecommendations.reduce((sum, rec) => sum + rec.score, 0);
      const avgScore = Number((totalScore / validRecommendations.length).toFixed(2));

      cashuLog.info('mint.kym.fetch', { mintUrl: normalizedMintUrl, score: avgScore, recommendationCount: validRecommendations.length });
      setScore(avgScore);
      setRecommendations(validRecommendations);
      setCached(normalizedMintUrl, avgScore, validRecommendations);
    } catch (err) {
      cashuLog.error('mint.kym.error', { mintUrl: normalizedMintUrl, error: err instanceof Error ? err : new Error(String(err)) });
      setError('Failed to process mint recommendations. Please try again.');
      const cached = getCached(normalizedMintUrl);
      if (cached && !isStale(normalizedMintUrl)) {
        setScore(cached.score);
        setRecommendations(cached.recommendations);
      } else {
        setScore(undefined);
        setRecommendations(undefined);
      }
    } finally {
      if (eose) setLoading(false);
    }
  }, [events, normalizedMintUrl, eose, getCached, setCached, isStale]);

  return { score, recommendations, loading, error };
};
