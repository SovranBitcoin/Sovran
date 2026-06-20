/**
 * @fileoverview Composer entry + publish actions.
 *
 * `useOpenComposer` primes the draft store and navigates to the modal (target
 * read from the store, not route params — cheap navigation, no FeedEvent
 * serialization). `usePublishNote` uploads any pending media, serializes the
 * block model to kind:1, and publishes through the outbox-aware seam.
 */
import { useCallback } from 'react';

import { NDKEvent, useNDK } from '@nostr-dev-kit/ndk-mobile';
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { router } from 'expo-router';

import { nostrLog } from '@/shared/lib/logger';
import { getOwnWriteRelays } from '@/shared/lib/nostr/outbox/relayListStore';
import { resolveOutboxRelays } from '@/shared/lib/nostr/outbox/recipientRelays';
import { publishEvent } from '@/shared/lib/nostr/publish';
import { buildPollEvent } from '@/features/feed/components/nostr/poll/buildPollEvents';
import {
  useComposerStore,
  type ComposerOpenContext,
} from '@/features/composer/state/composerStore';
import { buildNoteEvent, type ComposerTarget } from '@/features/composer/publish/buildNoteEvent';
import type { ComposerBlock } from '@/features/composer/config/types';

type ComposerSnapshot = ReturnType<typeof useComposerStore.getState>;

/** Returns a function that opens the composer for a given target. */
export function useOpenComposer(): (target: ComposerTarget, context?: ComposerOpenContext) => void {
  const open = useComposerStore((s) => s.open);
  return useCallback(
    (target, context) => {
      open(target, context);
      router.navigate('/composer');
    },
    [open]
  );
}

export type PublishOutcome =
  | 'ok'
  | 'no-key'
  | 'media-pending'
  | 'empty'
  | 'poll-invalid'
  | 'failed';

/** Publishes a NIP-88 poll (kind:1068). The composer text is the question. */
async function publishPoll(ndk: NDK, state: ComposerSnapshot): Promise<PublishOutcome> {
  const poll = state.poll;
  if (!poll) return 'empty';
  const question = state.blocks
    .map((b) => (b.kind === 'text' ? b.text : ''))
    .join('\n')
    .trim();
  const options = poll.options.filter((o) => o.label.trim().length > 0);
  if (question.length === 0 || options.length < 2) return 'poll-invalid';

  const ownWrite = getOwnWriteRelays();
  const unsigned = buildPollEvent({
    question,
    options,
    pollType: poll.type,
    endsAt: poll.endsAt,
    relays: ownWrite,
    quote:
      state.target?.mode === 'quote'
        ? {
            eventId: state.target.quotedId,
            pubkey: state.target.quotedPubkey,
            relayHint: state.target.relayHint,
          }
        : undefined,
  });
  const event = new NDKEvent(ndk);
  event.kind = unsigned.kind;
  event.content = unsigned.content;
  event.created_at = unsigned.created_at;
  event.tags = unsigned.tags;

  const result = await publishEvent({ ndk, event, relays: ownWrite, resolveOn: 'all-settled' });
  if (result.isErr()) {
    nostrLog.warn('composer.poll_publish_failed', { reason: result.error.type });
    return 'failed';
  }
  nostrLog.info('composer.poll_published', { options: options.length });
  useComposerStore.getState().close();
  return 'ok';
}

export interface ComposedDraft {
  blocks: readonly ComposerBlock[];
  target: ComposerTarget;
  mentionPubkeys?: readonly string[];
  contentWarning?: string;
}

/**
 * Builds + publishes a kind:1 note from a draft through the outbox-aware seam.
 * Shared by the full composer (`usePublishNote`) and the thread reply bar, so
 * both reuse outbox routing without coupling to the global composer store.
 */
export async function publishComposed(ndk: NDK, draft: ComposedDraft): Promise<PublishOutcome> {
  if (!ndk?.signer) return 'no-key';
  if (draft.blocks.some((b) => b.kind === 'media' && !b.descriptor)) return 'media-pending';

  const note = buildNoteEvent({
    blocks: draft.blocks,
    target: draft.target,
    mentionPubkeys: draft.mentionPubkeys,
    contentWarning: draft.contentWarning,
  });
  if (note.content.trim().length === 0 && !note.tags.some((t) => t[0] === 'imeta')) {
    return 'empty';
  }

  const relayHint = getOwnWriteRelays()[0];
  const mentionPubkeys = note.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
  const relays = await resolveOutboxRelays(ndk, {
    ownWriteRelays: getOwnWriteRelays(),
    mentionPubkeys,
    hintRelays: relayHint ? [relayHint] : undefined,
  });

  const event = new NDKEvent(ndk);
  event.kind = note.kind;
  event.content = note.content;
  event.created_at = note.created_at;
  event.tags = note.tags;

  const result = await publishEvent({ ndk, event, relays, resolveOn: 'all-settled' });
  if (result.isErr()) {
    nostrLog.warn('composer.publish_failed', { reason: result.error.type });
    return 'failed';
  }
  nostrLog.info('composer.published', {
    mode: draft.target.mode,
    accepted: result.value.accepted.length,
  });
  return 'ok';
}

/** Returns a function that publishes the current composer draft. */
export function usePublishNote(): () => Promise<PublishOutcome> {
  const { ndk } = useNDK();

  return useCallback(async (): Promise<PublishOutcome> => {
    if (!ndk?.signer) return 'no-key';
    const state = useComposerStore.getState();

    // Poll mode publishes a NIP-88 kind:1068 instead of a kind:1 note.
    if (state.poll) {
      const pendingMedia = state.blocks.some((b) => b.kind === 'media' && !b.descriptor);
      if (pendingMedia) return 'media-pending';
      return publishPoll(ndk, state);
    }

    const outcome = await publishComposed(ndk, {
      blocks: state.blocks,
      target: state.target ?? { mode: 'new' },
      mentionPubkeys: state.mentionPubkeys,
      contentWarning: state.contentWarning,
    });
    if (outcome === 'ok') useComposerStore.getState().close();
    return outcome;
  }, [ndk]);
}
