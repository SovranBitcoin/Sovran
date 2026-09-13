import { renderHook, waitFor } from '@testing-library/react-native';
import { useDmThread } from '@/features/payments/hooks/useDmThread';
import { useDmConversations } from '@/features/payments/hooks/useDmConversations';
import { useDmLastMessageStore } from '@/shared/stores/profile/dmLastMessageStore';
import type { DmEnvelopePage } from '@/features/payments/data/dmEnvelopeTypes';

const mockInbox = jest.fn();
const mockDirect = jest.fn(async (..._args: unknown[]) => ({ envelopes: [], hasNextPage: false }));
jest.mock('@/features/payments/data/dmEnvelopeClient', () => ({
  fetchDmEnvelopes: (...args: unknown[]) => mockInbox(...args),
  fetchDmConversation: (...args: unknown[]) => mockDirect(...args),
}));
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: { cache: { hydrate: async () => {} } },
}));
jest.mock('@/shared/lib/nostr/nip04Cache', () => ({ nip04Cache: { hydrate: async () => {} } }));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { warn: jest.fn() },
  storeLog: { warn: jest.fn() },
}));
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
      createdAt: e.createdAt,
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
  mockInbox.mockReset();
  mockDirect.mockClear();
  await useDmLastMessageStore.persist.rehydrate();
  useDmLastMessageStore.setState({ byPeer: {} });
});
it('uses the same inbox as Contacts when its message came from a fallback relay', async () => {
  mockInbox.mockResolvedValue(page('peer', 1, 1000));
  const { result } = renderHook(() => useDmThread('peer', 'viewer', key));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(mockDirect).not.toHaveBeenCalled();
});
it('finds a conversation beyond an unrelated first page without needing a scrollable message', async () => {
  mockInbox
    .mockResolvedValueOnce(page('other', 50, 1000))
    .mockResolvedValueOnce(page('peer', 1, 900));
  const { result } = renderHook(() => useDmThread('peer', 'viewer', key));
  await waitFor(() => expect(result.current.messages).toHaveLength(1));
  expect(mockInbox).toHaveBeenCalledTimes(2);
  expect(mockInbox.mock.calls[1][0].until).toBeLessThan(1000);
});
it('stops searching when a source repeats its page', async () => {
  mockInbox.mockResolvedValue(page('other', 50, 1000));
  const { result } = renderHook(() => useDmThread('peer', 'viewer', key));
  await waitFor(() => expect(mockInbox).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.hasMore).toBe(false);
  expect(result.current.messages).toEqual([]);
});

describe.each(['thread', 'conversations'] as const)('%s last-message recording', (source) => {
  const peer = 'a'.repeat(64);
  function useHistory(viewer = mockViewer) {
    // Each parameterized suite always calls the same hook.
    const thread = useDmThread(
      source === 'thread' ? peer : '',
      source === 'thread' ? viewer : undefined,
      key
    );
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
