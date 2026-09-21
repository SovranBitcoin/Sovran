import { act, renderHook, waitFor } from '@testing-library/react-native';
import { paymentLog } from '@/shared/lib/logger';
import { useDmThread } from '@/features/payments/hooks/useDmThread';
import { useDmConversations } from '@/features/payments/hooks/useDmConversations';
import { useDmLastMessageStore } from '@/shared/stores/profile/dmLastMessageStore';
import type { DmEnvelopePage } from '@/features/payments/data/dmEnvelopeTypes';
import { dmConversationsCache, dmThreadCache } from '@/features/payments/data/dmSnapshotCaches';

const mockInbox = jest.fn();
const mockDirect = jest.fn(async (..._args: unknown[]) => ({ envelopes: [], hasNextPage: false }));
const mockLive = jest.fn();
jest.mock('@/features/payments/data/dmEnvelopeClient', () => ({
  fetchDmEnvelopes: (...args: unknown[]) => mockInbox(...args),
  fetchDmConversation: (...args: unknown[]) => mockDirect(...args),
  subscribeDmEnvelopesLive: (...args: unknown[]) => mockLive(...args),
}));
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { cache: { hydrate: async () => {} } },
}));
jest.mock('@/shared/lib/nostr/nip04Cache', () => ({ nip04Cache: { hydrate: async () => {} } }));
jest.mock('@/shared/lib/logger', () => {
  const sink = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return {
    paymentLog: { warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    storeLog: sink,
    log: { ...sink, child: () => sink },
    monotonicNow: () => Date.now(),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
const mockViewer = 'viewer';
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, pubkey: mockViewer }],
    }),
  },
}));
const mockFictionalPeer = 'f'.repeat(64);
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({
  isMockContactPubkey: (pubkey: string) => pubkey === mockFictionalPeer,
}));
jest.mock('@/features/payments/data/dmDecryptPipeline', () => ({
  decryptDmEnvelopes: (envelopes: DmEnvelopePage['envelopes']) =>
    envelopes.map((e) => ({
      id: e.id,
      counterparty: e.pubkey,
      senderPubkey: e.pubkey,
      content: e.content,
      createdAtSec: e.createdAt,
      isOwn: false,
      protocol: e.kind === 4 ? 'nip04' : 'nip17',
    })),
}));
const key = new Uint8Array(32);
function page(peer: string, count: number, newest: number): DmEnvelopePage {
  return {
    hasNextPage: count >= 50,
    envelopes: Array.from({ length: count }, (_, i) => ({
      id: `${peer}-${newest - i}`,
      pubkey: peer,
      createdAt: newest - i,
      kind: 1059,
      content: 'Earlier message',
      tags: [],
    })),
  };
}
beforeEach(async () => {
  jest.clearAllMocks();
  mockInbox.mockReset();
  mockDirect.mockClear();
  mockLive.mockReset().mockReturnValue(() => {});
  dmThreadCache.clear();
  dmConversationsCache.clear();
  await useDmLastMessageStore.persist.rehydrate();
  useDmLastMessageStore.setState({ byPeer: {} });
});
it('uses the same inbox as Contacts when its message came from a fallback relay', async () => {
  mockInbox.mockResolvedValue(page('peer', 1, 1000));
  const { result } = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(mockDirect).not.toHaveBeenCalled();
});
it('finds a conversation beyond an unrelated first page without needing a scrollable message', async () => {
  mockInbox
    .mockResolvedValueOnce(page('other', 50, 1000))
    .mockResolvedValueOnce(page('peer', 1, 900));
  const { result } = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(mockInbox).toHaveBeenCalledTimes(2);
  expect(mockInbox.mock.calls[1][0].until).toBeLessThan(1000);
});
it('stops searching when a source repeats its page', async () => {
  mockInbox.mockResolvedValue(page('other', 50, 1000));
  const { result } = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.hasMore).toBe(false);
  expect(result.current.messages).toEqual([]);
});

describe.each(['thread', 'conversations'] as const)('%s last-message recording', (source) => {
  const peer = 'a'.repeat(64);
  function useHistory(viewer = mockViewer) {
    // Each parameterized suite always calls the same hook.
    const thread = useDmThread({
      counterparty: source === 'thread' ? peer : '',
      viewerPubkey: source === 'thread' ? viewer : undefined,
      viewerPrivateKey: key,
    });
    const conversations = useDmConversations(source === 'conversations' ? viewer : undefined, key);
    return source === 'thread' ? thread : conversations;
  }

  it('records decrypted metadata across the inbox, before thread protocol filtering', async () => {
    const incoming = page(peer, 1, 1000);
    incoming.envelopes.push({
      ...incoming.envelopes[0],
      id: 'legacy-newer',
      kind: 4,
      createdAt: 1001,
    });
    mockInbox.mockResolvedValue(incoming);
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() =>
      expect(useDmLastMessageStore.getState().byPeer[peer]).toEqual({
        protocol: 'nip04',
        atSeconds: 1001,
        isOwn: false,
      })
    );
  });

  it('does not persist fictional contacts', async () => {
    mockInbox.mockResolvedValue(page(mockFictionalPeer, 1, 1000));
    const { result } = renderHook(() => useHistory());
    await waitFor(() => expect(mockInbox).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(useDmLastMessageStore.getState().byPeer).toEqual({});
  });

  it('rejects metadata decrypted for an inactive profile', async () => {
    mockInbox.mockResolvedValue(page(peer, 1, 1000));
    const { result } = renderHook(() => useHistory('previous-viewer'));
    await waitFor(() => expect(mockInbox).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(useDmLastMessageStore.getState().byPeer).toEqual({});
  });
});

it('settles the first empty page while later inbox pages are still pending', async () => {
  let finishSecond!: (page: DmEnvelopePage) => void;
  mockInbox.mockResolvedValueOnce(page('other', 50, 1000)).mockImplementationOnce(
    () =>
      new Promise<DmEnvelopePage>((resolve) => {
        finishSecond = resolve;
      })
  );
  const { result } = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(2));
  expect(result.current.hasLoadedOnce).toBe(true);
  expect(result.current.loading).toBe(true);
  expect(result.current.messages).toEqual([]);
  expect(paymentLog.info).toHaveBeenCalledWith('dm.thread.first_page', {
    ms: expect.any(Number),
    count: 0,
  });
  await act(async () => finishSecond(page('peer', 1, 900)));
  expect(result.current.loading).toBe(false);
  expect(result.current.messages).toHaveLength(1);
  expect(paymentLog.info).toHaveBeenCalledTimes(1);
});

it('settles failed first loads and resets readiness when the conversation changes', async () => {
  mockInbox.mockRejectedValueOnce(new Error('Unavailable'));
  const { result, rerender } = renderHook(
    ({ peer }: { peer: string }) =>
      useDmThread({ counterparty: peer, viewerPubkey: 'viewer', viewerPrivateKey: key }),
    {
      initialProps: { peer: 'peer' },
    }
  );
  await waitFor(() => expect(result.current.hasLoadedOnce).toBe(true));
  expect(result.current.loading).toBe(false);
  expect(result.current.error).toBeInstanceOf(Error);
  mockInbox.mockImplementationOnce(() => new Promise(() => {}));
  rerender({ peer: 'another-peer' });
  expect(result.current.hasLoadedOnce).toBe(false);
  expect(result.current.loading).toBe(true);
  expect(result.current.messages).toEqual([]);
});

it('keeps the thread on screen across a refresh and merges the replacement page', async () => {
  let finish!: (p: DmEnvelopePage) => void;
  mockInbox
    .mockResolvedValueOnce(page('peer', 1, 900))
    .mockImplementationOnce(() => new Promise<DmEnvelopePage>((r) => (finish = r)));
  const { result } = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.messages).toHaveLength(1);

  act(() => result.current.refresh());
  await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(2));
  expect(result.current.status).toBe('revalidating');
  expect(result.current.messages).toHaveLength(1);

  await act(async () => finish(page('peer', 2, 950)));
  expect(result.current.status).toBe('ready');
  expect(result.current.messages.map((m) => m.id)).toEqual(['peer-900', 'peer-949', 'peer-950']);
});

it("seeds a re-opened thread from this session's snapshot and revalidates behind it", async () => {
  mockInbox.mockResolvedValueOnce(page('peer', 1, 900));
  const first = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(first.result.current.status).toBe('ready'));
  first.unmount();

  mockInbox.mockImplementationOnce(() => new Promise(() => {}));
  const second = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  expect(second.result.current.messages).toHaveLength(1);
  expect(second.result.current.status).toBe('revalidating');
  expect(second.result.current.loading).toBe(false);
});

it('never seeds a thread snapshot across viewers', async () => {
  mockInbox.mockResolvedValueOnce(page('peer', 1, 900));
  const first = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'viewer', viewerPrivateKey: key })
  );
  await waitFor(() => expect(first.result.current.status).toBe('ready'));
  first.unmount();
  mockInbox.mockImplementationOnce(() => new Promise(() => {}));
  const other = renderHook(() =>
    useDmThread({ counterparty: 'peer', viewerPubkey: 'other-viewer', viewerPrivateKey: key })
  );
  expect(other.result.current.messages).toEqual([]);
  expect(other.result.current.status).toBe('loading');
});

describe('conversation list seeding', () => {
  it('paints last-message metadata rows before the first page and replaces them in place', async () => {
    useDmLastMessageStore.getState().recordLastMessage('a'.repeat(64), {
      protocol: 'nip17',
      atSeconds: 500,
      isOwn: false,
    });
    let finish!: (p: DmEnvelopePage) => void;
    mockInbox.mockImplementationOnce(() => new Promise<DmEnvelopePage>((r) => (finish = r)));
    const { result } = renderHook(() => useDmConversations('viewer', key));
    expect(result.current.conversations).toEqual([
      expect.objectContaining({ counterparty: 'a'.repeat(64), previewPending: true }),
    ]);
    expect(result.current.status).toBe('revalidating');

    await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(1));
    await act(async () => finish(page('peer', 1, 900)));
    expect(result.current.status).toBe('ready');
    expect(result.current.conversations).toEqual([
      expect.objectContaining({ counterparty: 'peer', lastMessagePreview: 'Earlier message' }),
    ]);
    expect(result.current.conversations[0].previewPending).toBeUndefined();
  });

  it('folds live arrivals into the bucket while focused and unsubscribes on blur', async () => {
    mockInbox.mockResolvedValueOnce(page('peer', 1, 900));
    const unsubscribe = jest.fn();
    mockLive.mockReturnValue(unsubscribe);
    const { result, rerender } = renderHook(
      ({ live }: { live: boolean }) => useDmConversations('viewer', key, { live }),
      { initialProps: { live: true } }
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockLive).toHaveBeenCalledTimes(1);
    const onPage = mockLive.mock.calls[0][1] as (p: DmEnvelopePage) => void;
    act(() => onPage(page('newcomer', 1, 2000)));
    expect(result.current.conversations.map((c) => c.counterparty)).toEqual(['newcomer', 'peer']);
    rerender({ live: false });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
