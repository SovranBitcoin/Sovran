/**
 * @fileoverview Build NIP-88 poll (kind:1068) and vote (kind:1018) events.
 * Pure — kept independent of the composer's draft shape.
 */
import { POLL_KIND, POLL_VOTE_KIND } from '@/features/feed/components/nostr/poll/pollParse';
import type { PollOption, PollType } from '@/features/feed/components/nostr/poll/pollTypes';

interface UnsignedPollEvent {
  kind: number;
  content: string;
  created_at: number;
  tags: string[][];
}

interface PollQuoteReference {
  eventId: string;
  pubkey: string;
  relayHint?: string;
}

/** Builds the kind:1068 poll event. */
export function buildPollEvent(opts: {
  question: string;
  options: readonly PollOption[];
  pollType: PollType;
  endsAt?: number;
  relays?: readonly string[];
  quote?: PollQuoteReference;
  createdAt?: number;
}): UnsignedPollEvent {
  const tags: string[][] = [];
  for (const option of opts.options) tags.push(['option', option.id, option.label]);
  tags.push(['polltype', opts.pollType]);
  if (opts.endsAt !== undefined) tags.push(['endsAt', String(opts.endsAt)]);
  for (const relay of opts.relays ?? []) tags.push(['relay', relay]);
  if (opts.quote) {
    tags.push(['q', opts.quote.eventId, opts.quote.relayHint ?? '', opts.quote.pubkey]);
    tags.push(['p', opts.quote.pubkey]);
  }
  return {
    kind: POLL_KIND,
    content: opts.question,
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
  };
}

/** Builds the kind:1018 vote event referencing the poll. */
export function buildVoteEvent(opts: {
  pollId: string;
  optionIds: readonly string[];
  relayHint?: string;
  createdAt?: number;
}): UnsignedPollEvent {
  const tags: string[][] = [['e', opts.pollId, opts.relayHint ?? '']];
  for (const optionId of opts.optionIds) tags.push(['response', optionId]);
  return {
    kind: POLL_VOTE_KIND,
    content: '',
    created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
    tags,
  };
}
