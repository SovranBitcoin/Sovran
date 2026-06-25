/**
 * Delete-post orchestration: author gate, imeta-`x` blob extraction, per-relay
 * leg wiring via `onRelayResult`, and the rule that the note is only marked
 * "delete requested" (tombstone) when at least one relay accepts the kind:5.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/nostr/publish', () => ({ __esModule: true, publishEvent: jest.fn() }));
jest.mock('@/shared/lib/nostr/media/blossomClient', () => ({
  __esModule: true,
  deleteFromBlossom: jest.fn(),
  checkBlobExists: jest.fn(),
}));
jest.mock('@/shared/stores/profile/ownedMediaStore', () => ({
  __esModule: true,
  useOwnedMediaStore: {
    getState: () => ({ recordBlobs: jest.fn(), setDeleteState: jest.fn() }),
  },
}));
jest.mock('@/shared/lib/popup', () => ({ __esModule: true, deleteStatusPopup: jest.fn() }));
jest.mock('@/shared/lib/nostr/outbox/relayListStore', () => ({
  __esModule: true,
  getOwnWriteRelays: () => ['wss://w'],
  useRelayListStore: { getState: () => ({ entries: [{ url: 'wss://r1' }, { url: 'wss://r2' }] }) },
}));
jest.mock('@/shared/stores/profile/nostrSocialStore', () => {
  const markDeleteRequested = jest.fn();
  return {
    __esModule: true,
    useNostrSocialStore: { getState: () => ({ markDeleteRequested }) },
    __mock: { markDeleteRequested },
  };
});
jest.mock('@/shared/stores/runtime/deleteStatusStore', () => {
  const store = {
    start: jest.fn(),
    setActiveLeg: jest.fn(),
    setLegDone: jest.fn(),
    setLegFailed: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
  };
  return { __esModule: true, useDeleteStatusStore: { getState: () => store }, __mock: { store } };
});
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  __esModule: true,
  useNostrKeysContext: () => ({ keys: null }),
}));
jest.mock('nostr-tools/kinds', () => ({ __esModule: true, EventDeletion: 5 }));
jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class {},
    NDKEvent: class {
      kind = 0;
      content = '';
      created_at = 0;
      tags: string[][] = [];
    },
    useNDK: () => ({ ndk: {} }),
  }),
  { virtual: true }
);
jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  nostrLog: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { executeDeletePost } from '@/features/feed/hooks/useDeletePost';
import type { FeedEvent } from '@/features/feed/components/nostr/feedTypes';

const publishEvent = jest.requireMock('@/shared/lib/nostr/publish').publishEvent as jest.Mock;
const deleteFromBlossom = jest.requireMock('@/shared/lib/nostr/media/blossomClient')
  .deleteFromBlossom as jest.Mock;
const markDeleteRequested = (
  jest.requireMock('@/shared/stores/profile/nostrSocialStore') as {
    __mock: { markDeleteRequested: jest.Mock };
  }
).__mock.markDeleteRequested;
const deleteStore = (
  jest.requireMock('@/shared/stores/runtime/deleteStatusStore') as {
    __mock: { store: Record<string, jest.Mock> };
  }
).__mock.store;

const SHA = 'a'.repeat(64);
const ndk = Object.create(null) as never;

const okResult = (anyAccepted: boolean) => ({
  isOk: () => true,
  value: { anyAccepted, accepted: [], failed: [] },
});

function makeEvent(over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id: `note-${Math.random().toString(36).slice(2)}`,
    kind: 1,
    pubkey: 'abc',
    content: '',
    tags: [['imeta', 'url https://blossom.example/abc.jpg', `x ${SHA}`, 'm image/jpeg']],
    created_at: 0,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  deleteFromBlossom.mockReturnValue({ isOk: () => true, isErr: () => false });
  publishEvent.mockResolvedValue(okResult(true));
});

describe('executeDeletePost', () => {
  it('refuses to delete a post authored by someone else', async () => {
    await executeDeletePost({ ndk, pubkey: 'me', event: makeEvent({ pubkey: 'someone-else' }) });

    expect(deleteStore.start).not.toHaveBeenCalled();
    expect(publishEvent).not.toHaveBeenCalled();
    expect(markDeleteRequested).not.toHaveBeenCalled();
  });

  it('deletes the declared blob and marks delete-requested on relay accept', async () => {
    const event = makeEvent({ pubkey: 'ME' }); // case-insensitive author match
    await executeDeletePost({ ndk, pubkey: 'me', event });

    expect(deleteFromBlossom).toHaveBeenCalledWith(
      expect.objectContaining({ server: 'https://blossom.example', sha256: SHA })
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({ relays: ['wss://r1', 'wss://r2'], resolveOn: 'all-settled' })
    );
    expect(markDeleteRequested).toHaveBeenCalledWith(event.id);
    expect(deleteStore.complete).toHaveBeenCalled();
  });

  it('does NOT mark delete-requested when every relay rejects', async () => {
    publishEvent.mockResolvedValueOnce(okResult(false));
    await executeDeletePost({ ndk, pubkey: 'abc', event: makeEvent() });

    expect(markDeleteRequested).not.toHaveBeenCalled();
    expect(deleteStore.fail).toHaveBeenCalled();
    expect(deleteStore.complete).not.toHaveBeenCalled();
  });

  it('drives per-relay legs from onRelayResult', async () => {
    publishEvent.mockImplementationOnce(async (opts: Record<string, unknown>) => {
      const cb = opts.onRelayResult as (r: unknown) => void;
      cb({ url: 'wss://r1', ok: true });
      cb({ url: 'wss://r2', ok: false, reason: 'rejected' });
      return okResult(true);
    });
    await executeDeletePost({ ndk, pubkey: 'abc', event: makeEvent() });

    expect(deleteStore.setLegDone).toHaveBeenCalledWith('relay-wss://r1');
    expect(deleteStore.setLegFailed).toHaveBeenCalledWith('relay-wss://r2', 'rejected');
  });

  it('skips blob deletion when the note declares no imeta x', async () => {
    await executeDeletePost({ ndk, pubkey: 'abc', event: makeEvent({ tags: [] }) });

    expect(deleteFromBlossom).not.toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalled(); // note deletion still goes out
  });
});
