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
import {
  ingestOwnProfileMetadata,
  parseOwnProfileSnapshot,
} from '@/shared/lib/nostr/profile/publishOwnProfileMetadata';
import { useEffect, useMemo, useRef } from 'react';
import { useFollowSync } from './useFollowSync';
import { useMuteListSync } from './useMuteListSync';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';

import { nostrLog } from '@/shared/lib/logger';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { ingestOwnMediaBlobs } from '@/shared/stores/profile/ownedMediaStore';

import { OWN_EVENT_KINDS, partitionOwnEvents, type OwnSyncEvent } from './partitionOwnEvents';
import { Contacts, Metadata } from 'nostr-tools/kinds';
import { hasFeature } from '@/shared/config/features';

/**
 * Without the feed (ADR 0021) only the profile and follow list are consumed,
 * so notes, reactions, reposts and deletions are not requested at all.
 */
const SYNC_KINDS = hasFeature('feed')
  ? OWN_EVENT_KINDS
  : OWN_EVENT_KINDS.filter((kind) => kind === Metadata || kind === Contacts);

/** Kinds kept as history; the profile and follow list are replaceable and asked for alone. */
const HISTORY_KINDS = SYNC_KINDS.filter((kind) => kind !== Metadata && kind !== Contacts);

/**
 * Backfill window for the history kinds only. A relay applies `since` to every
 * kind, so a profile or follow list last changed before it would never arrive;
 * those two have their own unwindowed filters, newest only.
 */
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
  const snapshot = parseOwnProfileSnapshot(event);
  if (snapshot && useProfileStore.getState().getActiveProfile()?.pubkey === event.pubkey) {
    ingestOwnProfileMetadata(snapshot, event.pubkey, accountIndex);
  }
}

export function useOwnEventsSync(): void {
  useMuteListSync();
  useFollowSync();
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  const activeAccountIndex = useProfileStore((s) => s.activeAccountIndex);

  // Stable per-pubkey filters (since computed once per pubkey, not per render).
  const filters = useMemo(() => {
    if (!pubkey) return null;
    const since = Math.floor(Date.now() / 1000) - BACKFILL_SEC;
    return [
      { authors: [pubkey], kinds: [Metadata], limit: 1 },
      { authors: [pubkey], kinds: [Contacts], limit: 1 },
      ...(HISTORY_KINDS.length > 0
        ? [{ authors: [pubkey], kinds: HISTORY_KINDS, since, limit: PER_KIND_LIMIT }]
        : []),
    ];
  }, [pubkey]);

  const { events } = useSubscribe({ filters, opts: OWN_SUBSCRIBE_OPTS });

  // Only dispatch events we haven't seen; reset when the active profile changes.
  const processedRef = useRef<Set<string>>(new Set());
  // Newest kind:0 created_at applied so far — guards against an older profile
  // event (in a later/out-of-order batch) regressing the cached name/avatar.
  const lastProfileCreatedAtSecRef = useRef(0);
  useEffect(() => {
    processedRef.current = new Set();
    lastProfileCreatedAtSecRef.current = 0;
  }, [pubkey]);

  useEffect(() => {
    if (!pubkey || !events?.length) return;
    const fresh: OwnSyncEvent[] = [];
    for (const raw of events) {
      const id = (raw as { id?: string }).id;
      if (!id || processedRef.current.has(id)) continue;
      processedRef.current.add(id);
      const event = toOwnSyncEvent(raw as Parameters<typeof toOwnSyncEvent>[0]);
      // A follow list replaces this account's saved one: only its own counts.
      if (event.kind === Contacts && event.pubkey !== pubkey) continue;
      fresh.push(event);
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
      ingestOwnMediaBlobs(part.ownNotes, pubkey);
    }
    if (
      part.latestContacts &&
      useProfileStore.getState().getActiveProfile()?.pubkey === part.latestContacts.pubkey
    ) {
      social.setContactsFromRelay({
        tags: part.latestContacts.tags,
        content: part.latestContacts.content,
        createdAtSec: part.latestContacts.created_at,
      });
      social.clearSettledFollowOptimistic();
    }
    if (part.latestProfile && part.latestProfile.created_at > lastProfileCreatedAtSecRef.current) {
      applyProfile(part.latestProfile, activeAccountIndex);
      lastProfileCreatedAtSecRef.current = part.latestProfile.created_at;
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
