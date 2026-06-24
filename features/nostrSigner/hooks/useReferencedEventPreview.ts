/**
 * @fileoverview Referenced-note preview fetch for signer approval surfaces
 *
 * Resolves the note a request references (the post being liked, reposted, or
 * replied to) so the approval sheet can show real content instead of a hex
 * id. Primary path is the nagg backend's enrichment endpoint (one validated
 * call returns the event AND its author profile); falls back to an NDK relay
 * fetch plus the kind-0 metadata cache when nagg misses or the device is
 * offline. The hook never blocks the sheet: it reports loading/unavailable
 * and the cards render text fallbacks.
 *
 * Module-level runtime cache (LRU ~50). Referenced events are public notes,
 * but they stay out of persistence anyway. Note ids are sent to our own nagg
 * backend — accepted metadata footprint, never logged with content.
 */

import { useEffect, useState } from 'react';
import { useNDK } from '@nostr-dev-kit/ndk-mobile';

import { getFeedClient } from '@/features/feed/data/useFeedClient';
import type { FeedEvent, ProfileInfo } from '@/features/feed/components/nostr/feedTypes';
import { useNostrProfileMetadata } from '@/shared/hooks/useNostrProfileMetadata';
import { nostrLog, redactError } from '@/shared/lib/logger';
import { isNostrPubkeyHex } from '@/shared/lib/nostr/secureStorage';

interface ReferencedEventPreview {
  status: 'idle' | 'loading' | 'ready' | 'unavailable';
  event?: FeedEvent;
  author?: { name?: string; picture?: string };
}

type CacheEntry = { event: FeedEvent; author?: ProfileInfo } | 'missing';

const CACHE_CAP = 50;
const previewCache = new Map<string, CacheEntry>();

function cachePut(eventId: string, entry: CacheEntry): void {
  if (previewCache.has(eventId)) previewCache.delete(eventId);
  previewCache.set(eventId, entry);
  if (previewCache.size > CACHE_CAP) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
}

async function fetchFromNagg(eventId: string): Promise<CacheEntry | null> {
  try {
    const updates = await getFeedClient().enrich({
      missingQuotedIds: [eventId],
      missingProfilePubkeys: [],
    });
    const event = updates.quotedEvents?.get(eventId);
    if (event === undefined) return null;
    const author = updates.profiles?.get(event.pubkey);
    return { event, ...(author !== undefined && { author }) };
  } catch (error) {
    nostrLog.debug('nostr.signer.preview_nagg_failed', { error: redactError(error) });
    return null;
  }
}

export function useReferencedEventPreview(eventId: string | undefined): ReferencedEventPreview {
  const { ndk } = useNDK();
  const [resolved, setResolved] = useState<{ id: string; entry: CacheEntry } | null>(() => {
    const cached = eventId !== undefined ? previewCache.get(eventId) : undefined;
    return cached !== undefined && eventId !== undefined ? { id: eventId, entry: cached } : null;
  });

  useEffect(() => {
    if (eventId === undefined || !isNostrPubkeyHex(eventId)) return;
    const cached = previewCache.get(eventId);
    if (cached !== undefined) {
      setResolved({ id: eventId, entry: cached });
      return;
    }

    let cancelled = false;
    void (async () => {
      let entry = await fetchFromNagg(eventId);
      if (entry === null && ndk) {
        // Relay fallback — covers nagg outages and notes nagg hasn't indexed.
        try {
          const ndkEvent = await ndk.fetchEvent({ ids: [eventId] });
          if (ndkEvent && typeof ndkEvent.content === 'string') {
            entry = {
              event: {
                id: eventId,
                kind: ndkEvent.kind ?? 1,
                pubkey: ndkEvent.pubkey,
                content: ndkEvent.content,
                tags: ndkEvent.tags as string[][],
                created_at: ndkEvent.created_at ?? 0,
              },
            };
          }
        } catch (error) {
          nostrLog.debug('nostr.signer.preview_ndk_failed', { error: redactError(error) });
        }
      }
      const final: CacheEntry = entry ?? 'missing';
      cachePut(eventId, final);
      if (!cancelled) setResolved({ id: eventId, entry: final });
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, ndk]);

  // Author metadata fallback (NDK kind-0 cache) when nagg didn't supply one.
  const fallbackAuthorPubkey =
    resolved !== null && resolved.entry !== 'missing' && resolved.entry.author === undefined
      ? resolved.entry.event.pubkey
      : undefined;
  const { metadata } = useNostrProfileMetadata(fallbackAuthorPubkey);

  if (eventId === undefined) return { status: 'idle' };
  if (resolved?.id !== eventId) return { status: 'loading' };
  if (resolved.entry === 'missing') return { status: 'unavailable' };
  const author =
    resolved.entry.author ??
    (metadata !== undefined
      ? {
          ...(metadata.displayName || metadata.name
            ? { name: metadata.displayName || metadata.name }
            : {}),
          ...(metadata.picture !== undefined && { picture: metadata.picture }),
        }
      : undefined);
  return {
    status: 'ready',
    event: resolved.entry.event,
    ...(author !== undefined && { author }),
  };
}
