/**
 * @fileoverview Parse a NIP-88 `kind:1068` poll event + tally `kind:1018` votes.
 *
 * Poll tags: `["option","<id>","<label>"]`, `["polltype","singlechoice"|
 * "multiplechoice"]`, `["endsAt","<unix>"]`, `["relay","<url>"]`.
 * Vote tags: `["e","<pollId>"]`, `["response","<optionId>"]` (one per choice).
 * Tally rule: the latest `kind:1018` per pubkey (before `endsAt`) wins; for
 * single-choice only its first response counts. Pure + unit-tested.
 */
import type {
  PollDefinition,
  PollTally,
  PollType,
} from '@/features/feed/components/nostr/poll/pollTypes';

/** The kind:1068 poll event kind. */
export const POLL_KIND = 1068;
/** The kind:1018 vote event kind. */
export const POLL_VOTE_KIND = 1018;

interface EventLike {
  id?: string;
  pubkey?: string;
  content?: string;
  created_at?: number;
  tags?: unknown;
}

function tagsOf(event: EventLike): string[][] {
  return Array.isArray(event.tags)
    ? event.tags.filter((t): t is string[] => Array.isArray(t) && typeof t[0] === 'string')
    : [];
}

/** Parses a kind:1068 event into a poll definition. */
export function parsePoll(event: EventLike): PollDefinition {
  const tags = tagsOf(event);
  // Single pass: keep `option` tags with a string id and project to {id,label}.
  const options: PollDefinition['options'] = [];
  for (const t of tags) {
    if (t[0] === 'option' && typeof t[1] === 'string') {
      options.push({ id: t[1], label: typeof t[2] === 'string' ? t[2] : '' });
    }
  }

  const pollTypeTag = tags.find((t) => t[0] === 'polltype')?.[1];
  const pollType: PollType = pollTypeTag === 'multiplechoice' ? 'multiplechoice' : 'singlechoice';

  const endsAtRaw = tags.find((t) => t[0] === 'endsAt')?.[1];
  const endsAt = endsAtRaw && /^\d+$/.test(endsAtRaw) ? Number(endsAtRaw) : undefined;

  const relays: string[] = [];
  for (const t of tags) {
    if (t[0] === 'relay' && typeof t[1] === 'string') relays.push(t[1]);
  }

  return {
    id: event.id ?? '',
    pubkey: event.pubkey ?? '',
    question: event.content ?? '',
    options,
    pollType,
    endsAt,
    relays,
  };
}

/**
 * Tallies votes for a poll. Keeps the latest vote per pubkey (before `endsAt`),
 * counts each response against the poll's known options, and reports the
 * viewer's own selections.
 */
export function tallyPoll(
  poll: PollDefinition,
  voteEvents: readonly EventLike[],
  viewerPubkey?: string
): PollTally {
  const validOptionIds = new Set(poll.options.map((o) => o.id));

  // Latest vote per pubkey (before expiry).
  const latestByPubkey = new Map<string, EventLike>();
  for (const event of voteEvents) {
    const pubkey = event.pubkey;
    const createdAt = event.created_at ?? 0;
    if (!pubkey) continue;
    if (poll.endsAt !== undefined && createdAt > poll.endsAt) continue;
    const prev = latestByPubkey.get(pubkey);
    if (!prev || createdAt > (prev.created_at ?? 0)) latestByPubkey.set(pubkey, event);
  }

  const counts: Record<string, number> = {};
  for (const id of validOptionIds) counts[id] = 0;
  let total = 0;
  let myVote: string[] = [];

  for (const [pubkey, event] of latestByPubkey) {
    let responses = tagsOf(event)
      .filter((t) => t[0] === 'response' && validOptionIds.has(t[1]))
      .map((t) => t[1]);
    if (responses.length === 0) continue;
    if (poll.pollType === 'singlechoice') responses = [responses[0]];
    // Dedupe a voter's repeated choice of the same option.
    const unique = [...new Set(responses)];
    for (const optionId of unique) counts[optionId] += 1;
    total += 1;
    if (viewerPubkey && pubkey === viewerPubkey) myVote = unique;
  }

  return { counts, total, myVote };
}

/** Whether the poll has closed (endsAt in the past). */
export function isPollClosed(poll: PollDefinition, nowSec: number): boolean {
  return poll.endsAt !== undefined && poll.endsAt <= nowSec;
}
