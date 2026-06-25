/**
 * ownedMediaStore: durable upsert (merge note ids, never downgrade a deleted
 * blob), deleteState transitions, on-demand check folding, and the
 * own-kind:1-only ingest seam.
 */
import {
  ingestOwnMediaBlobs,
  selectOwnedBlobs,
  useOwnedMediaStore,
} from '@/shared/stores/profile/ownedMediaStore';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

const SHA = 'a'.repeat(64);
const HOST = 'https://b';
const blob = { sha256: SHA, url: `${HOST}/${SHA}`, host: HOST };

/** The single entry for the canonical test blob. */
const entry = () => selectOwnedBlobs(useOwnedMediaStore.getState()).find((b) => b.host === HOST);

beforeEach(() => useOwnedMediaStore.setState({ byBlob: {} }));

describe('ownedMediaStore', () => {
  it('records new blobs as live and merges sourceNoteIds on re-record', () => {
    const s = useOwnedMediaStore.getState();
    s.recordBlobs([blob], 'note1');
    expect(entry()?.deleteState).toBe('live');
    expect(entry()?.sourceNoteIds).toEqual(['note1']);

    s.recordBlobs([blob], 'note2');
    expect(entry()?.sourceNoteIds).toEqual(['note1', 'note2']);
  });

  it('never downgrades a deleted blob back to live on re-record', () => {
    const s = useOwnedMediaStore.getState();
    s.recordBlobs([blob]);
    s.setDeleteState(HOST, SHA, 'deleted');
    s.recordBlobs([blob], 'note3');
    expect(entry()?.deleteState).toBe('deleted');
  });

  it('markChecked: gone→deleted, still-there-after-attempt→delete-failed, live stays live', () => {
    const s = useOwnedMediaStore.getState();
    s.recordBlobs([blob]);

    s.markChecked(HOST, SHA, true); // live + exists → still live
    expect(entry()?.deleteState).toBe('live');

    s.setDeleteState(HOST, SHA, 'delete-requested');
    s.markChecked(HOST, SHA, true); // attempted + still there → delete-failed
    expect(entry()?.deleteState).toBe('delete-failed');

    s.markChecked(HOST, SHA, false); // gone → deleted
    expect(entry()?.deleteState).toBe('deleted');
  });

  it('tracks the same sha on two hosts independently (deleting one keeps the other live)', () => {
    const s = useOwnedMediaStore.getState();
    const hostA = 'https://a';
    const hostB = 'https://b';
    s.recordBlobs([
      { sha256: SHA, url: `${hostA}/${SHA}`, host: hostA },
      { sha256: SHA, url: `${hostB}/${SHA}`, host: hostB },
    ]);
    const all = selectOwnedBlobs(useOwnedMediaStore.getState());
    expect(all).toHaveLength(2);

    s.setDeleteState(hostA, SHA, 'deleted');
    const byHost = Object.fromEntries(
      selectOwnedBlobs(useOwnedMediaStore.getState()).map((b) => [b.host, b.deleteState])
    );
    expect(byHost[hostA]).toBe('deleted');
    expect(byHost[hostB]).toBe('live'); // the copy on B is untouched
  });
});

describe('ingestOwnMediaBlobs', () => {
  it('records blobs only from our own kind:1 events', () => {
    const SHA_OTHER = 'c'.repeat(64);
    const own: FeedEvent = {
      id: 'n',
      kind: 1,
      pubkey: 'me',
      content: '',
      tags: [['imeta', `url https://b/${SHA}.jpg`, `x ${SHA}`]],
      created_at: 0,
    };
    const other: FeedEvent = {
      ...own,
      id: 'n2',
      pubkey: 'someone-else',
      tags: [['imeta', `url https://b/${SHA_OTHER}.jpg`, `x ${SHA_OTHER}`]],
    };

    ingestOwnMediaBlobs([own, other], 'me');

    const all = selectOwnedBlobs(useOwnedMediaStore.getState());
    expect(all).toHaveLength(1);
    expect(all[0].sha256).toBe(SHA);
    expect(all[0].sourceNoteIds).toEqual(['n']);
  });
});
