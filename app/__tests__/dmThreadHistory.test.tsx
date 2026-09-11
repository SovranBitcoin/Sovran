import { renderHook, waitFor } from '@testing-library/react-native';
import { useDmThread } from '@/features/payments/hooks/useDmThread';
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
jest.mock('@/shared/lib/logger', () => ({ paymentLog: { warn: jest.fn() } }));
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
beforeEach(() => {
  mockInbox.mockReset();
  mockDirect.mockClear();
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
