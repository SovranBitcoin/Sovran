/**
 * @fileoverview `useOwnEventsSync` — one long-lived, app-level relay
 * subscription for our own profile and follow list (kind 0/3), hydrating the
 * canonical own-state stores so they're authoritative everywhere. The other
 * own kinds (1/5/6/7) are no longer requested now that no build ships a feed;
 * the dispatch below still routes them if a batch carries any.
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
import { selectActivePubkey, useProfileStore } from '@/shared/stores/global/profileStore';
import { useNostrSocialStore } from '@/shared/stores/profile/nostrSocialStore';
import { useOwnContentStore } from '@/shared/stores/profile/ownContentStore';
import { useOwnProfileMetadataStore } from '@/shared/stores/profile/ownProfileMetadataStore';
import { ingestOwnMediaBlobs } from '@/shared/stores/profile/ownedMediaStore';

import { partitionOwnEvents, type OwnSyncEvent } from './partitionOwnEvents';
import { Contacts, Metadata } from 'nostr-tools/kinds';
import { supersedes } from 'nostr';

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

/**
 * One account's sync: what it has dispatched and the newest profile it
 * applied. Made when that account's keys appear and replaced when they change
 * (`sessionFor`), so nothing one account saw carries over to the next.
 */
type OwnSyncSession = {
  /** The account's pubkey: only events it signed are dispatched, and only while it is active. */
  owner: string;
  /** Event ids already dispatched for `owner`. */
  seen: Set<string>;
  /** The newest profile applied, by `supersedes`; one it does not supersede in a later batch is ignored. */
  profileNewest: { created_at: number; id: string } | null;
};

/** The saved own profile's time and id, the newest this account has applied before. */
function savedProfileNewest(): OwnSyncSession['profileNewest'] {
  const saved = useOwnProfileMetadataStore.getState().latest;
  return saved && { created_at: saved.createdAt, id: saved.eventId };
}

/** Whether `profile` is newer than every profile `session` has applied. One without a time (read as 0) never is. */
function admitsProfile(session: OwnSyncSession, profile: OwnSyncEvent): boolean {
  if (profile.created_at <= 0) return false;
  return !session.profileNewest || supersedes(profile, session.profileNewest);
}

function sessionFor(
  current: OwnSyncSession | null,
  owner: string | undefined
): OwnSyncSession | null {
  if (!owner) return null;
  if (current?.owner === owner) return current;
  return { owner, seen: new Set<string>(), profileNewest: null };
}

export function useOwnEventsSync(): void {
  useMuteListSync();
  useFollowSync();
  const { keys } = useNostrKeysContext();
  const pubkey = keys?.pubkey;
  // Read for its changes only: the check below reads the store as it is now.
  const activePubkey = useProfileStore(selectActivePubkey);

  // Stable per-pubkey filters. Only the profile and follow list are consumed
  // (no build ships a feed), and both are replaceable, so each is asked for
  // alone, newest only, with no time window: a relay applies `since` to every
  // kind, so one last changed before a window would never arrive.
  const filters = useMemo(() => {
    if (!pubkey) return null;
    return [
      { authors: [pubkey], kinds: [Metadata], limit: 1 },
      { authors: [pubkey], kinds: [Contacts], limit: 1 },
    ];
  }, [pubkey]);

  const { events } = useSubscribe({ filters, opts: OWN_SUBSCRIBE_OPTS });

  const sessionRef = useRef<OwnSyncSession | null>(null);

  useEffect(() => {
    const session = sessionFor(sessionRef.current, pubkey);
    sessionRef.current = session;
    if (!session || !events?.length) return;
    // The profile-scoped stores hold the active account's state. While the keys
    // and the active account disagree (mid-switch) write nothing, and mark
    // nothing seen, so the batch is dispatched once they agree.
    const active = useProfileStore.getState().getActiveProfile();
    if (!active || active.pubkey !== session.owner) return;
    const fresh: OwnSyncEvent[] = [];
    for (const raw of events) {
      const id = (raw as { id?: string }).id;
      if (!id || session.seen.has(id)) continue;
      const event = toOwnSyncEvent(raw as Parameters<typeof toOwnSyncEvent>[0]);
      // An event still held from the previous account's subscription.
      if (event.pubkey !== session.owner) continue;
      session.seen.add(id);
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
      ingestOwnMediaBlobs(part.ownNotes, session.owner);
    }
    if (part.latestContacts) {
      social.setContactsFromRelay({
        tags: part.latestContacts.tags,
        content: part.latestContacts.content,
        createdAtSec: part.latestContacts.created_at,
        eventId: part.latestContacts.id,
      });
      social.clearSettledFollowOptimistic();
    }
    const profile = part.latestProfile;
    // A new session starts from the saved profile, so it never replaces it
    // with one it would not have chosen had both arrived together.
    if (!session.profileNewest) session.profileNewest = savedProfileNewest();
    if (profile && admitsProfile(session, profile)) {
      const snapshot = parseOwnProfileSnapshot(profile);
      if (snapshot) ingestOwnProfileMetadata(snapshot, session.owner, active.accountIndex);
      session.profileNewest = { created_at: profile.created_at, id: profile.id };
    }

    nostrLog.debug('nostr.ownsync.ingested', {
      fresh: fresh.length,
      likes: part.likes.length,
      reposts: part.reposts.length,
      replies: part.replies.length,
      notes: part.ownNotes.length,
      deletions: part.deletedEventIds.length,
    });
  }, [events, pubkey, activePubkey]);
}
