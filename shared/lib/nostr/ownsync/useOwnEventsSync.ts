/**
 * @fileoverview `useOwnEventsSync` — one long-lived, app-level relay
 * subscription for ALL of our own events (kind 0/1/3/5/6/7), hydrating the
 * canonical own-state stores so they're authoritative everywhere.
 *
 * This is the single owner of "keep my own state synced from relays". It
 * replaces the previously-scattered fetches (per-screen engagement subs, the
 * profile-screen contact sub, the boot kind:0 sync) and does NOT use nagg —
 * viewer-state (liked/reposted/replied/followed) is relay-direct (see ADR 0002).
 *
 * Dispatch (via the pure `partitionOwnEvents`):
 *   kind 0 → profileStore metadata
 *   kind 3 → nostrSocialStore.setContactsFromRelay (follows)
 *   kind 1 → ownContentStore.ingestSeen + reply e-tags → nostrSocialStore.ingestOwnReplies
 *   kind 6/7 → nostrSocialStore.ingestOwnReposts/ingestOwnLikes (global upsert)
 *   kind 5 → nostrSocialStore.applyOwnDeletions
 */
import { useEffect, useMemo, useRef } from 'react';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';

import { OWN_EVENT_KINDS, partitionOwnEvents, type OwnSyncEvent } from './partitionOwnEvents';

/** Backfill window for our own events. Replaceable kinds (0/3) ignore it. */
const BACKFILL_SEC = 365 * 24 * 60 * 60; // 1 year
const PER_KIND_LIMIT = 5000;

// Module-level so the reference is stable across renders — a fresh opts object
// makes useSubscribe tear down on EOSE and re-render-loop (see
// useNostrProfileMetadata). closeOnEose:false keeps it live for cross-client updates.
const OWN_SUBSCRIBE_OPTS = { closeOnEose: false } as const;

function toOwnSyncEvent(raw: {
  id: string;
  kind: number;
  pubkey: string;
  content?: unknown;
  tags?: unknown;
  created_at?: number;
}): OwnSyncEvent {
  return {
    id: raw.id,
    kind: raw.kind,
    pubkey: raw.pubkey,
    content: typeof raw.content === 'string' ? raw.content : '',
    tags: Array.isArray(raw.tags) ? (raw.tags as string[][]) : [],
    created_at: raw.created_at ?? 0,
  };
}

function applyProfile(event: OwnSyncEvent, accountIndex: number): void {
  try {
    const parsed = JSON.parse(event.content) as {
      display_name?: string;
      name?: string;
      picture?: string;
    };
    const displayName = parsed.display_name || parsed.name || undefined;
    const picture = parsed.picture || undefined;
    useProfileStore.getState().updateProfileMetadata(accountIndex, displayName, picture);
  } catch {
    // Malformed kind:0 content — ignore.
  }
}

export function useOwnEventsSync(): void {
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  // Stable per-pubkey filters (since computed once per pubkey, not per render).
  const filters = useMemo(() => {
    if (!pubkey) return null;
    const since = Math.floor(Date.now() / 1000) - BACKFILL_SEC;
    return [{ authors: [pubkey], kinds: OWN_EVENT_KINDS, since, limit: PER_KIND_LIMIT }];
  }, [pubkey]);

  const { events } = useSubscribe({ filters, opts: OWN_SUBSCRIBE_OPTS });

  // Only dispatch events we haven't seen; reset when the active profile changes.
  const processedRef = useRef<Set<string>>(new Set());
  // Newest kind:0 created_at applied so far — guards against an older profile
  // event (in a later/out-of-order batch) regressing the cached name/avatar.
  const lastProfileAtRef = useRef(0);
  useEffect(() => {
    processedRef.current = new Set();
    lastProfileAtRef.current = 0;
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || !events?.length) return;
    const fresh: OwnSyncEvent[] = [];
    for (const raw of events) {
      const id = (raw as { id?: string }).id;
      if (!id || processedRef.current.has(id)) continue;
      processedRef.current.add(id);
      fresh.push(toOwnSyncEvent(raw as Parameters<typeof toOwnSyncEvent>[0]));
    }
    if (fresh.length === 0) return;

    const part = partitionOwnEvents(fresh);
    const social = useNostrSocialStore.getState();
    social.ingestOwnLikes(part.likes);
    social.ingestOwnReposts(part.reposts);
    social.ingestOwnReplies(part.replies);
    social.applyOwnDeletions(part.deletedEventIds);
    if (part.ownNotes.length > 0) {
      const own = useOwnContentStore.getState();
      for (const note of part.ownNotes) own.ingestSeen(note);
    }
    if (part.latestContacts) {
      social.setContactsFromRelay({
        tags: part.latestContacts.tags,
        content: part.latestContacts.content,
        createdAt: part.latestContacts.created_at,
      });
      social.clearSettledFollowOptimistic();
    }
    if (part.latestProfile && part.latestProfile.created_at > lastProfileAtRef.current) {
      applyProfile(part.latestProfile, activeAccountIndex);
      lastProfileAtRef.current = part.latestProfile.created_at;
    }

    nostrLog.debug('nostr.ownsync.ingested', {
      fresh: fresh.length,
      likes: part.likes.length,
      reposts: part.reposts.length,
      replies: part.replies.length,
      notes: part.ownNotes.length,
      deletions: part.deletedEventIds.length,
    });
  }, [events, pubkey, activeAccountIndex]);
}
