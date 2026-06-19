/**
 * @fileoverview Subscribes to a poll's `kind:1018` votes via NDK relays.
 *
 * Poll tallying is app-specific NIP-88 semantics (latest-per-pubkey, endsAt
 * cutoff), so it stays an app-side relay subscription rather than a generic
 * nagg recipe — nagg remains protocol-generic.
 */
import { useMemo } from 'react';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';

import { POLL_VOTE_KIND } from '@/features/feed/components/nostr/poll/pollParse';

interface VoteEvent {
  pubkey?: string;
  created_at?: number;
  tags?: unknown;
}

/** Returns the raw `kind:1018` vote events referencing `pollId`. */
export function usePollVotes(pollId: string): VoteEvent[] {
  const filters = useMemo(
    () => (pollId ? [{ kinds: [POLL_VOTE_KIND], '#e': [pollId], limit: 1000 }] : null),
    [pollId]
  );
  const { events } = useSubscribe({ filters });
  return (events ?? []) as VoteEvent[];
}
