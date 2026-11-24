/**
 * Recent-contacts read states (hunch rule ui/read-states): the hook maps the DM
 * conversation read into rows + a status a screen can gate on.
 */
import { renderHook } from '@testing-library/react-native';
import { useNip17RecentContacts } from '@/features/payments/hooks/useNip17RecentContacts';
import type { DmConversation } from '@/features/payments/hooks/useDmConversations';

let mockMode = false;
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: (selector: (s: { mockMode: boolean }) => unknown) => selector({ mockMode }),
}));
jest.mock('@/shared/stores/runtime/mockDataStore', () => ({
  getMockContacts: () => [],
  MOCK_ALLOWED_PUBKEYS_HEX: [],
}));
const mockDm = {
  conversations: [] as DmConversation[],
  loading: false,
  refreshing: false,
  hasLoadedOnce: false,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
  error: null as Error | null,
  status: 'loading' as const,
};
const mockUseDmConversations = jest.fn((..._args: unknown[]) => mockDm);
jest.mock('@/features/payments/hooks/useDmConversations', () => ({
  useDmConversations: (...args: unknown[]) => mockUseDmConversations(...args),
}));

const PEER = 'a'.repeat(64);
const keys = { pubkey: 'b'.repeat(64), privateKey: new Uint8Array(32) };

beforeEach(() => {
  mockMode = false;
  mockUseDmConversations.mockClear();
  mockDm.conversations = [];
  mockDm.status = 'loading';
  mockDm.error = null;
});

describe('useNip17RecentContacts read state', () => {
  it('passes the read status and error through and marks seeded rows as preview-loading', () => {
    mockDm.conversations = [
      {
        counterparty: PEER,
        lastMessagePreview: '',
        lastMessageAtSec: 500,
        protocol: 'nip17',
        newestMessageId: '',
        previewPending: true,
      },
    ];
    Object.assign(mockDm, { status: 'revalidating' });
    const { result } = renderHook(() => useNip17RecentContacts(keys, { live: true }));
    expect(result.current.status).toBe('revalidating');
    const row = result.current.displayContacts[0];
    expect(row).toMatchObject({ pubkey: PEER, previewLoading: true, dmEvent: null });
    expect(row.newestMessageId).toBeUndefined();
    expect(mockUseDmConversations).toHaveBeenLastCalledWith(keys.pubkey, keys.privateKey, {
      live: true,
    });
  });

  it('surfaces a failed first read as status error with the error object', () => {
    Object.assign(mockDm, { status: 'error', error: new Error('nagg unavailable') });
    const { result } = renderHook(() => useNip17RecentContacts(keys));
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toBe('nagg unavailable');
  });

  it('never reports loading or error in mock mode and never subscribes live', () => {
    mockMode = true;
    Object.assign(mockDm, { status: 'error', error: new Error('x') });
    const { result } = renderHook(() => useNip17RecentContacts(keys, { live: true }));
    expect(result.current.status).toBe('ready');
    expect(result.current.error).toBeNull();
    expect(mockUseDmConversations).toHaveBeenLastCalledWith(undefined, undefined, { live: false });
  });
});
