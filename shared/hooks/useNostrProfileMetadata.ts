import { useEffect, useMemo, useRef } from 'react';
import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import { Metadata } from 'nostr-tools/kinds';
import {
  Kind0MetadataSchema,
  useCachedNostrProfile,
  useNostrMetadataCache,
  type NostrProfileMetadata,
} from '@/shared/stores/global/nostrMetadataCache';
import { nostrLog } from '@/shared/lib/logger';

const STALE_TTL_MS = 24 * 60 * 60 * 1000;

// `useSubscribe` puts `opts` in its re-subscribe effect deps
// (ndk-mobile/src/hooks/subscribe.ts). A fresh `{ closeOnEose: true }`
// per render fails Object.is, the subscription tears down on EOSE,
// `handleClosed` triggers a re-render, and we loop forever
// ("Maximum update depth exceeded"). Module-level constant fixes it.
const SUBSCRIBE_OPTS = { closeOnEose: true } as const;

interface UseNostrProfileMetadataResult {
  metadata: NostrProfileMetadata | undefined;
  isLoading: boolean;
}

export function useNostrProfileMetadata(pubkey: string | undefined): UseNostrProfileMetadataResult {
  const setProfile = useNostrMetadataCache((s) => s.setProfile);
  const { metadata, isStale, isMissing } = useCachedNostrProfile(pubkey ?? '');

  const filters = useMemo(() => {
    if (!pubkey) return null;
    if (!isMissing && !isStale) return null;
    return [{ kinds: [Metadata], authors: [pubkey], limit: 1 }];
  }, [pubkey, isMissing, isStale]);

  const { events, eose } = useSubscribe({ filters, opts: SUBSCRIBE_OPTS });

  // NDK hands back a fresh `events` array on every relay buffer flush.
  // Without an event-id guard, we'd JSON.parse the same kind-0 ~50ms on
  // every flush during EOSE traffic. Track the last id we processed.
  const lastProcessedId = useRef<string | null>(null);
  useEffect(() => {
    if (!pubkey || !events?.length) return;
    const newest = events.reduce(
      (best, e) => ((e.created_at ?? 0) > (best.created_at ?? 0) ? e : best),
      events[0]
    );
    if (newest.id === lastProcessedId.current) return;
    lastProcessedId.current = newest.id ?? null;
    const parsed = parseRawMetadata(newest.content);
    if (!parsed) {
      nostrLog.warn('nostr.metadata.parse_failed', { pubkey: pubkey.slice(0, 8) });
      return;
    }
    setProfile(pubkey, parsed);
  }, [events, pubkey, setProfile]);

  const isLoading = isMissing && !eose;
  return { metadata, isLoading };
}

/**
 * Parse a raw kind-0 `content` JSON string into the cache's profile shape.
 * Exported so other surfaces (e.g. colada's `resolveRecipientProfile`
 * operation in `features/send/providers/Colada.tsx`) reuse the exact
 * same Zod schema + field-mapping as the hook — keeps `display_name` /
 * `displayName` aliasing and the rest of the metadata interpretation in one
 * place.
 */
export function parseRawMetadata(content: string): Omit<NostrProfileMetadata, 'fetchedAt'> | null {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return null;
  }
  const result = Kind0MetadataSchema.safeParse(json);
  if (!result.success) return null;
  const raw = result.data;
  return {
    displayName: raw.display_name ?? raw.displayName,
    name: raw.name,
    picture: raw.picture,
    banner: raw.banner,
    nip05: raw.nip05,
    lud16: raw.lud16,
    website: raw.website,
    about: raw.about,
  };
}

interface UseNostrProfileMetadataManyResult {
  /** Cached metadata for every pubkey we know about. Pubkeys still
   *  loading on first paint are absent from the map — callers can use
   *  `metadata.has(pubkey)` to drive loading skeletons. */
  metadata: ReadonlyMap<string, NostrProfileMetadata>;
  /** True while the initial fetch for any pubkey hasn't returned EOSE. */
  isLoading: boolean;
}

/**
 * SWR over many pubkeys at once. Backed by the same `nostrMetadataCache`
 * as the single-pubkey hook — populating one set of contacts warms the
 * cache for every other surface that consumes them (UserMessagesScreen,
 * UserProfileScreen, the picker, …). One batched kind-0 subscription
 * per render with `authors: missingOrStale` so we don't repeatedly hit
 * relays for entries we already have.
 */
export function useNostrProfileMetadataMany(
  pubkeys: readonly string[]
): UseNostrProfileMetadataManyResult {
  const setManyProfiles = useNostrMetadataCache((s) => s.setManyProfiles);
  const byPubkey = useNostrMetadataCache((s) => s.byPubkey);

  // Stable key from sorted pubkeys so a fresh array reference with
  // identical contents doesn't re-trigger memos / subscriptions.
  const stableKey = useMemo(() => [...pubkeys].sort().join(','), [pubkeys]);

  const metadata = useMemo(() => {
    const map = new Map<string, NostrProfileMetadata>();
    for (const pk of pubkeys) {
      const entry = byPubkey[pk];
      if (entry) map.set(pk, entry);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey, byPubkey]);

  const filters = useMemo(() => {
    if (pubkeys.length === 0) return null;
    const now = Date.now();
    const needsFetch: string[] = [];
    for (const pk of pubkeys) {
      const entry = byPubkey[pk];
      if (!entry || now - entry.fetchedAt > STALE_TTL_MS) needsFetch.push(pk);
    }
    if (needsFetch.length === 0) return null;
    return [{ kinds: [Metadata], authors: needsFetch }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableKey, byPubkey]);

  const { events, eose } = useSubscribe({ filters });

  // Track high-water-mark for processed events so a fresh `events`
  // reference (NDK buffer flush) doesn't re-parse rows we've already
  // committed to the cache. The store's `setProfile` short-circuits
  // identical writes anyway but JSON.parse of the full batch is the
  // cost we want to avoid here.
  const processedCount = useRef(0);
  useEffect(() => {
    if (!events?.length) return;
    if (events.length === processedCount.current) return;
    processedCount.current = events.length;

    const newestByPubkey = new Map<string, { content: string; created_at: number }>();
    for (const e of events) {
      const ts = e.created_at ?? 0;
      const prev = newestByPubkey.get(e.pubkey);
      if (!prev || ts > prev.created_at) {
        newestByPubkey.set(e.pubkey, { content: e.content, created_at: ts });
      }
    }

    const batch: Record<string, Omit<NostrProfileMetadata, 'fetchedAt'>> = {};
    for (const [pk, { content }] of newestByPubkey) {
      const parsed = parseRawMetadata(content);
      if (parsed) batch[pk] = parsed;
      else nostrLog.warn('nostr.metadata.parse_failed', { pubkey: pk.slice(0, 8) });
    }
    if (Object.keys(batch).length > 0) setManyProfiles(batch);
  }, [events, setManyProfiles]);

  const isLoading = filters !== null && !eose;
  return { metadata, isLoading };
}
