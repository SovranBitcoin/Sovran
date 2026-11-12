/**
 * @jest-environment node
 *
 * The composer's in-memory draft store, as the FAB, Quote and reply entry
 * points and the composer screen drive it: what `open` resets, what `close`
 * keeps, and how blocks, the poll, the content warning and mentions change.
 * Real store; nothing replaced.
 */
import { useComposerStore } from '@/features/composer/state/composerStore';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

const PARENT: FeedEvent = {
  id: 'p'.repeat(64),
  kind: 1,
  pubkey: 'author',
  content: 'parent',
  tags: [],
  created_at: 1,
};
const state = () => useComposerStore.getState();

function firstTextId(): string {
  return state().blocks.find((b) => b.kind === 'text')!.id;
}

beforeEach(() => {
  state().open({ mode: 'new' });
});

describe('opening and closing the draft', () => {
  it('open starts a clean draft for the target, dropping everything from the last one', () => {
    state().setBlockText(firstTextId(), 'left over');
    state().addMediaBlock({ kind: 'media', mediaKind: 'image', localUri: 'file://x' });
    state().setPoll({ options: [], type: 'singlechoice' });

    state().open(
      { mode: 'reply', parentId: PARENT.id, parentPubkey: 'author' },
      { parentEvent: PARENT, parentProfile: { name: 'Author' } }
    );

    expect(state()).toMatchObject({
      target: { mode: 'reply', parentId: PARENT.id },
      poll: undefined,
      parentEvent: PARENT,
      parentProfile: { name: 'Author' },
    });
    expect(state().blocks).toEqual([{ id: expect.any(String), kind: 'text', text: '' }]);
  });

  it('gives each opened draft a fresh text block id', () => {
    const before = firstTextId();
    state().open({ mode: 'new' });
    expect(firstTextId()).not.toBe(before);
  });

  it('open without context clears the previous parent', () => {
    state().open({ mode: 'reply', parentId: 'x', parentPubkey: 'y' }, { parentEvent: PARENT });
    state().open({ mode: 'new' });
    expect(state().parentEvent).toBeUndefined();
  });

  it('close clears only the target and keeps the rest of the draft', () => {
    state().setBlockText(firstTextId(), 'kept');
    state().setPoll({ options: [{ id: 'a', label: 'A' }], type: 'singlechoice' });

    state().close();

    // QUIRK: a closed draft keeps its text, poll and parent until the next
    // open; only `target` says it is closed.
    expect(state().target).toBeNull();
    expect(state().blocks[0]).toMatchObject({ text: 'kept' });
    expect(state().poll?.options).toHaveLength(1);
  });
});

describe('editing the draft', () => {
  it('setBlockText changes only that text block', () => {
    const mediaId = state().addMediaBlock({ kind: 'media', mediaKind: 'image' });
    state().setBlockText(firstTextId(), 'hello');
    state().setBlockText(mediaId, 'ignored on media');

    expect(state().blocks.map((b) => (b.kind === 'text' ? b.text : b.kind))).toEqual([
      'hello',
      'media',
    ]);
  });

  it('adds media blocks after the text with their own ids, patches and removes them', () => {
    const one = state().addMediaBlock({ kind: 'media', mediaKind: 'image', localUri: 'file://1' });
    const two = state().addMediaBlock({ kind: 'media', mediaKind: 'video', localUri: 'file://2' });
    expect(one).not.toBe(two);

    state().updateBlock(one, { uploadProgress: 0.5, alt: 'a cat' });
    state().updateBlock(firstTextId(), { alt: 'not applied to text' });
    expect(state().blocks[1]).toMatchObject({ id: one, uploadProgress: 0.5, alt: 'a cat' });
    expect(state().blocks[0]).not.toHaveProperty('alt');

    state().removeBlock(one);
    expect(state().blocks.map((b) => b.id)).toEqual([firstTextId(), two]);
  });

  it('sets and clears the poll', () => {
    state().setPoll({ options: [], type: 'multiplechoice', endsAt: 5 });
    expect(state()).toMatchObject({ poll: { type: 'multiplechoice', endsAt: 5 } });

    state().setPoll(undefined);
    expect(state().poll).toBeUndefined();
  });
});
