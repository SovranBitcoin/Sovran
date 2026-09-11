/**
 * @fileoverview NIP-88 poll renderer.
 *
 * Renders a kind:1068 poll: tappable options before voting (radio for
 * single-choice, checkboxes for multiple), live results (bars + %) once the
 * viewer has voted or the poll has closed. Voting publishes a kind:1018 through
 * the central seam and works with the local signer (no key gating).
 */
import { useCallback, useMemo } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { StyleSheet, View } from 'react-native';
import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';

import Icon from 'assets/icons';
import { withAlpha } from '@/shared/lib/color';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { Text } from '@/shared/ui/primitives/Text';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';
import {
  isPollClosed,
  parsePoll,
  tallyPoll,
} from '@/features/feed/components/nostr/poll/pollParse';
import { buildVoteEvent } from '@/features/feed/components/nostr/poll/buildPollEvents';
import { usePollVotes } from '@/features/feed/components/nostr/poll/usePollVotes';

export function PollCard({ event }: { event: FeedEvent }) {
  const { ndk } = useNDK();
  const { keys } = useNostrKeysContext();
  const viewerPubkey = keys?.pubkey;
  const [foreground, accent, muted, success] = useThemeColor([
    'foreground',
    'accent',
    'muted',
    'success',
  ] as const);

  const poll = useMemo(() => parsePoll(event), [event]);
  const votes = usePollVotes(poll.id);
  const tally = useMemo(() => tallyPoll(poll, votes, viewerPubkey), [poll, votes, viewerPubkey]);
  const [selected, setSelected] = useRecyclingState<string[]>([], [poll.id, viewerPubkey]);
  const [pendingVote, setPendingVote] = useRecyclingState<object | null>(null, [
    poll.id,
    viewerPubkey,
  ]);
  const voting = pendingVote !== null;

  const closed = isPollClosed(poll, Math.floor(Date.now() / 1000));
  const voted = tally.myVote.length > 0;
  const showResults = voted || closed;
  const isMulti = poll.pollType === 'multiplechoice';

  const toggleSelect = useCallback(
    (id: string) => {
      if (showResults) return;
      setSelected((prev) =>
        isMulti ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]
      );
    },
    [isMulti, showResults, setSelected]
  );

  const submitVote = useCallback(async () => {
    if (!ndk || selected.length === 0 || voting) return;
    const submission = {};
    setPendingVote(submission);
    const unsigned = buildVoteEvent({
      pollId: poll.id,
      optionIds: selected,
      relayHint: poll.relays[0],
    });
    const voteEvent = new NDKEvent(ndk);
    voteEvent.kind = unsigned.kind;
    voteEvent.content = unsigned.content;
    voteEvent.created_at = unsigned.created_at;
    voteEvent.tags = unsigned.tags;
    await publishEvent({
      ndk,
      event: voteEvent,
      relays: [...poll.relays, ...DEFAULT_RELAYS],
      resolveOn: 'first-ok',
    });
    // A recycled cell or profile switch may have started another submission.
    // Only the operation that set the pending marker can clear it.
    setPendingVote((current) => (current === submission ? null : current));
  }, [ndk, selected, poll.id, poll.relays, voting, setPendingVote]);

  return (
    <View style={[styles.card, { borderColor: withAlpha(foreground, 0.12) }]}>
      {poll.question ? (
        <Text size={15} bold style={{ color: foreground, marginBottom: 8 }}>
          {poll.question}
        </Text>
      ) : null}

      {poll.options.map((option) => {
        const count = tally.counts[option.id] ?? 0;
        const pct = tally.total > 0 ? Math.round((count / tally.total) * 100) : 0;
        const mine = tally.myVote.includes(option.id);
        const isSelected = selected.includes(option.id);
        return (
          <Pressable
            key={option.id}
            onPress={() => toggleSelect(option.id)}
            disabled={showResults}
            style={[styles.option, { borderColor: withAlpha(foreground, 0.12) }]}>
            {showResults ? (
              <View
                style={[
                  styles.bar,
                  { width: `${pct}%`, backgroundColor: withAlpha(mine ? success : accent, 0.18) },
                ]}
              />
            ) : null}
            <View style={styles.optionRow}>
              {!showResults ? (
                <Icon
                  name={
                    isSelected
                      ? isMulti
                        ? 'mdi:checkbox-marked'
                        : 'mdi:radiobox-marked'
                      : isMulti
                        ? 'mdi:checkbox-blank-outline'
                        : 'mdi:radiobox-blank'
                  }
                  size={18}
                  color={isSelected ? accent : muted}
                />
              ) : null}
              <Text size={14} style={{ color: foreground, flex: 1 }}>
                {option.label}
              </Text>
              {showResults ? (
                <Text size={13} style={{ color: muted }}>
                  {pct}%
                </Text>
              ) : null}
              {mine ? <Icon name="mdi:check" size={16} color={success} /> : null}
            </View>
          </Pressable>
        );
      })}

      <View style={styles.footer}>
        <Text size={12} style={{ color: muted }}>
          {tally.total} {tally.total === 1 ? 'vote' : 'votes'}
          {closed ? ' · Poll ended' : ''}
        </Text>
        {!showResults ? (
          <Pressable
            onPress={submitVote}
            disabled={voting || selected.length === 0}
            style={[
              styles.voteButton,
              { backgroundColor: selected.length === 0 ? withAlpha(accent, 0.4) : accent },
            ]}>
            <Text size={13} bold style={{ color: foreground }}>
              {voting ? 'Voting…' : 'Vote'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginVertical: 6 },
  option: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    marginVertical: 3,
    overflow: 'hidden',
    justifyContent: 'center',
    minHeight: 40,
  },
  bar: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 10 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  voteButton: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16 },
});
