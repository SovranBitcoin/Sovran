/**
 * Delete-requested suppression in nostrSocialStore: mark our own deleted note
 * ids (drives the greyed tombstone) and the `selectIsDeleteRequested` selector.
 */
import {
  selectIsDeleteRequested,
  useNostrSocialStore,
} from '@/shared/stores/profile/nostrSocialStore';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

beforeEach(() => {
  useNostrSocialStore.setState({ deletedNoteIds: {} });
});

describe('nostrSocialStore delete-requested tracking', () => {
  it('marks a note delete-requested and the selector reflects it', () => {
    expect(selectIsDeleteRequested('n1')(useNostrSocialStore.getState())).toBe(false);

    useNostrSocialStore.getState().markDeleteRequested('n1');

    expect(selectIsDeleteRequested('n1')(useNostrSocialStore.getState())).toBe(true);
    expect(useNostrSocialStore.getState().deletedNoteIds.n1).toEqual(expect.any(Number));
  });

  it('keeps delete-requested ids separate from deleted reposts', () => {
    useNostrSocialStore.getState().markDeleteRequested('note');
    useNostrSocialStore.getState().markRepostDeleted('repost');

    const state = useNostrSocialStore.getState();
    expect(state.deletedNoteIds.note).toBeDefined();
    expect(state.deletedNoteIds.repost).toBeUndefined();
    expect(state.deletedRepostOriginalIds.repost).toBeDefined();
  });
});
