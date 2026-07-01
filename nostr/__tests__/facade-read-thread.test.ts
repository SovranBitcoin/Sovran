import { describe, it, expect } from 'vitest';
import { createNostrEntityCache } from '../src/facade/cache/entity-cache';
import { readThread } from '../src/facade/cache/read-thread';
import type { NaggFeedEvent } from '../src/map/feed';

function note(id: string, pubkey: string, tags: string[][] = []): NaggFeedEvent {
  return { id, kind: 1, pubkey, content: `note ${id}`, tags, created_at: 1000 };
}

describe('readThread (synchronous cache projection)', () => {
  it('returns root: undefined when the note is not cached', () => {
    const cache = createNostrEntityCache();
    const view = readThread(cache, 'missing');
    expect(view.root).toBeUndefined();
    expect(view.relatedNotes).toEqual([]);
  });

  it('walks the cached ancestor chain and attaches profiles + stats', () => {
    const cache = createNostrEntityCache();
    // root <- parent <- reply (the tapped note)
    const root = note('root', 'alice');
    const parent = note('parent', 'bob', [['e', 'root', '', 'root']]);
    const reply = note('reply', 'carol', [
      ['e', 'root', '', 'root'],
      ['e', 'parent', '', 'reply'],
    ]);
    cache.ingestNotes([root, parent, reply]);
    cache.ingestProfileInfos(
      { alice: { name: 'Alice', picture: 'a.png' }, bob: { name: 'Bob' }, carol: { name: 'Carol' } },
      'nagg',
    );
    cache.ingestNoteStats(
      { reply: { likes: 2, reposts: 0, replies: 0, zaps: 0, satsZapped: 0 } },
      'nagg',
    );

    const view = readThread(cache, 'reply');
    expect(view.root?.id).toBe('reply');
    const ids = view.relatedNotes.map((n) => n.id).sort();
    expect(ids).toEqual(['parent', 'root']); // ancestors gathered, root excluded
    expect(view.profiles.alice?.picture).toBe('a.png'); // author of an ancestor
    expect(view.profiles.carol?.name).toBe('Carol'); // author of the tapped note
    expect(view.stats.reply?.likes).toBe(2);
  });

  it('surfaces cached direct replies to the tapped note (reply previews)', () => {
    const cache = createNostrEntityCache();
    const root = note('root', 'alice');
    const reply = note('reply', 'bob', [['e', 'root', '', 'root']]);
    const unrelated = note('other', 'carol'); // references nothing — must be ignored
    cache.ingestNotes([root, reply, unrelated]);
    const view = readThread(cache, 'root');
    expect(view.root?.id).toBe('root');
    expect(view.relatedNotes.map((n) => n.id)).toEqual(['reply']);
  });

  it('returns no replies for an uncached tapped note (nothing to paint)', () => {
    const cache = createNostrEntityCache();
    const reply = note('reply', 'bob', [['e', 'root', '', 'root']]);
    cache.ingestNotes([reply]); // the reply is cached, but the tapped root is not
    const view = readThread(cache, 'root');
    expect(view.root).toBeUndefined();
    expect(view.relatedNotes).toEqual([]);
  });

  it('includes cached quoted (q-tag) bodies', () => {
    const cache = createNostrEntityCache();
    const quoted = note('quoted', 'dave');
    const main = note('main', 'alice', [['q', 'quoted']]);
    cache.ingestNotes([main, quoted]);
    const view = readThread(cache, 'main');
    expect(view.quoted.quoted?.id).toBe('quoted');
    expect(view.profiles.dave?.name).toBeUndefined(); // dave has no profile cached
  });
});
