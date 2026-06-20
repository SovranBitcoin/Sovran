/**
 * @fileoverview Pure partitioner for the own-events sync.
 *
 * Takes a batch of our own Nostr events (from the single `useOwnEventsSync`
 * subscription) and splits them into the rows each canonical store ingests:
 * profile (kind 0), contacts (kind 3), likes (7), reposts (6), replies (1 with
 * a reply e-tag), all own notes (1), and deletions (5). Kept pure so the
 * routing logic is unit-testable without NDK or stores.
 */
import {
  Contacts,
  EventDeletion,
  Metadata,
  Reaction,
  Repost,
  ShortTextNote,
} from 'nostr-tools/kinds';

import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

interface OwnLikeRow {
  targetEventId: string;
  reactionEventId: string;
  createdAt: number;
}
interface OwnRepostRow {
  targetEventId: string;
  repostEventId: string;
  createdAt: number;
}
interface OwnReplyRow {
  targetEventId: string;
  replyEventId: string;
  createdAt: number;
}

interface OwnEventsPartition {
  /** Newest kind:0 in the batch. */
  latestProfile?: FeedEvent;
  /** Newest kind:3 in the batch. */
  latestContacts?: FeedEvent;
  likes: OwnLikeRow[];
  reposts: OwnRepostRow[];
  replies: OwnReplyRow[];
  /** Every own kind:1 (posts, replies, quotes) — for ownContentStore. */
  ownNotes: FeedEvent[];
  /** Target event ids deleted by our kind:5 events. */
  deletedEventIds: string[];
}

/** First `e` tag value (the target of a like/repost). */
function firstETag(tags: string[][]): string | undefined {
  return tags.find((t) => t[0] === 'e' && !!t[1])?.[1];
}

/**
 * The reply target of a kind:1 per NIP-10: the `reply`-marked e-tag, else the
 * `root`-marked one, else the last UNMARKED e-tag (legacy positional). Returns
 * undefined for top-level notes and for quotes/mentions (whose e-tags are
 * `mention`-marked or absent) so they don't count as replies.
 */
function replyTarget(tags: string[][]): string | undefined {
  const eTags = tags.filter((t) => t[0] === 'e' && !!t[1]);
  if (eTags.length === 0) return undefined;
  const marked = (marker: string) => eTags.find((t) => t[3] === marker)?.[1];
  const reply = marked('reply');
  if (reply) return reply;
  const root = marked('root');
  if (root) return root;
  const unmarked = eTags.filter((t) => !t[3]);
  return unmarked.length > 0 ? unmarked[unmarked.length - 1][1] : undefined;
}

/** NIP-25: only `+` / empty reactions count as a "like". */
function isLikeReaction(content: string): boolean {
  return content === '+' || content === '';
}

export function partitionOwnEvents(events: readonly FeedEvent[]): OwnEventsPartition {
  const out: OwnEventsPartition = {
    likes: [],
    reposts: [],
    replies: [],
    ownNotes: [],
    deletedEventIds: [],
  };

  for (const event of events) {
    switch (event.kind) {
      case Metadata:
        if (!out.latestProfile || event.created_at > out.latestProfile.created_at) {
          out.latestProfile = event;
        }
        break;
      case Contacts:
        if (!out.latestContacts || event.created_at > out.latestContacts.created_at) {
          out.latestContacts = event;
        }
        break;
      case Reaction: {
        const target = firstETag(event.tags);
        if (target && isLikeReaction(event.content)) {
          out.likes.push({
            targetEventId: target,
            reactionEventId: event.id,
            createdAt: event.created_at,
          });
        }
        break;
      }
      case Repost: {
        const target = firstETag(event.tags);
        if (target) {
          out.reposts.push({
            targetEventId: target,
            repostEventId: event.id,
            createdAt: event.created_at,
          });
        }
        break;
      }
      case ShortTextNote: {
        out.ownNotes.push(event);
        const target = replyTarget(event.tags);
        if (target) {
          out.replies.push({
            targetEventId: target,
            replyEventId: event.id,
            createdAt: event.created_at,
          });
        }
        break;
      }
      case EventDeletion:
        for (const tag of event.tags) {
          if (tag[0] === 'e' && tag[1]) out.deletedEventIds.push(tag[1]);
        }
        break;
      default:
        break;
    }
  }

  return out;
}

/** Kinds the own-events sync subscribes to. */
export const OWN_EVENT_KINDS = [Metadata, ShortTextNote, Contacts, EventDeletion, Repost, Reaction];
