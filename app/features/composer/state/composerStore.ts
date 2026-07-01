/**
 * @fileoverview Composer draft state (in-memory, NOT persisted).
 *
 * Three entry points (new-post FAB, Quote, reply) prime the draft before the
 * modal mounts, so the draft lives in a store rather than screen state.
 * Deliberately not persisted — cross-profile draft bleed is a critical-failure
 * class; durable drafts go through NIP-37 instead. `open()` resets so a stale
 * quote never leaks into a new post.
 */
import { create } from 'zustand';

import type { ComposerBlock, PollDraft } from '@/features/composer/config/types';
import type { ComposerTarget } from '@/features/composer/publish/buildNoteEvent';
import type { FeedEvent, ProfileInfo } from '@/features/feed/components/nostr/feedTypes';

/** Display-only context for the composer (e.g. the post being replied to). */
export interface ComposerOpenContext {
  parentEvent?: FeedEvent;
  parentProfile?: ProfileInfo;
}

type MediaBlock = Extract<ComposerBlock, { kind: 'media' }>;

let blockSeq = 0;
const nextBlockId = (): string => `b${(blockSeq += 1)}`;

function emptyTextBlock(): ComposerBlock {
  return { id: nextBlockId(), kind: 'text', text: '' };
}

interface ComposerState {
  target: ComposerTarget | null;
  blocks: ComposerBlock[];
  contentWarning?: string;
  poll?: PollDraft;
  /** Pubkeys inserted via @-mention, for `p` tags. */
  mentionPubkeys: string[];
  /** The post being replied to (display-only; kept out of the pure target). */
  parentEvent?: FeedEvent;
  parentProfile?: ProfileInfo;

  open: (target: ComposerTarget, context?: ComposerOpenContext) => void;
  close: () => void;
  setBlockText: (id: string, text: string) => void;
  addMediaBlock: (block: Omit<MediaBlock, 'id'>) => string;
  updateBlock: (id: string, patch: Partial<MediaBlock>) => void;
  removeBlock: (id: string) => void;
  moveBlock: (from: number, to: number) => void;
  setContentWarning: (cw: string | undefined) => void;
  setPoll: (poll: PollDraft | undefined) => void;
  addMention: (pubkey: string) => void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  target: null,
  blocks: [emptyTextBlock()],
  contentWarning: undefined,
  poll: undefined,
  mentionPubkeys: [],
  parentEvent: undefined,
  parentProfile: undefined,

  open: (target, context) =>
    set({
      target,
      blocks: [emptyTextBlock()],
      contentWarning: undefined,
      poll: undefined,
      mentionPubkeys: [],
      parentEvent: context?.parentEvent,
      parentProfile: context?.parentProfile,
    }),

  close: () => set({ target: null }),

  setBlockText: (id, text) =>
    set({
      blocks: get().blocks.map((b) => (b.id === id && b.kind === 'text' ? { ...b, text } : b)),
    }),

  addMediaBlock: (block) => {
    const id = nextBlockId();
    const mediaBlock: ComposerBlock = { ...block, id };
    set({ blocks: [...get().blocks, mediaBlock] });
    return id;
  },

  updateBlock: (id, patch) =>
    set({
      blocks: get().blocks.map((b) => {
        if (b.id !== id || b.kind !== 'media') return b;
        const updated: MediaBlock = { ...b, ...patch };
        return updated;
      }),
    }),

  removeBlock: (id) => set({ blocks: get().blocks.filter((b) => b.id !== id) }),

  moveBlock: (from, to) => {
    const blocks = [...get().blocks];
    if (from < 0 || from >= blocks.length || to < 0 || to >= blocks.length) return;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(to, 0, moved);
    set({ blocks });
  },

  setContentWarning: (cw) => set({ contentWarning: cw }),
  setPoll: (poll) => set({ poll }),
  addMention: (pubkey) => set({ mentionPubkeys: [...new Set([...get().mentionPubkeys, pubkey])] }),
}));
