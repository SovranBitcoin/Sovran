import { prefetchThread } from '../lib/prefetchThread';

const EVENT_ID = 'f'.repeat(64);

let mockRoot: { id: string } | undefined;
let mockLayer: { readThread: (id: string) => { root?: { id: string } } } | null;
const mockGetThread = jest.fn();
const mockDispose = jest.fn();

jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => mockLayer,
}));
jest.mock('@/features/feed/data/useFeedClient', () => ({
  getFeedClient: () => ({ getThread: mockGetThread, dispose: mockDispose }),
}));
jest.mock('@/shared/lib/logger', () => ({
  feedLog: { info: jest.fn(), warn: jest.fn() },
}));

const served = (read?: { status: string }) => ({
  allEvents: new Map([[EVENT_ID, { id: EVENT_ID }]]),
  tier: 'nagg',
  ...(read ? { read } : {}),
});

beforeEach(() => {
  mockRoot = undefined;
  mockLayer = { readThread: () => ({ ...(mockRoot ? { root: mockRoot } : {}) }) };
  mockGetThread.mockReset().mockResolvedValue(served());
  mockDispose.mockReset();
});

describe('prefetchThread', () => {
  it('warms a note the cache has never seen, and disposes its client', async () => {
    await prefetchThread(EVENT_ID);
    expect(mockGetThread).toHaveBeenCalledWith({ eventId: EVENT_ID });
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a note the cache can already project a thread from', async () => {
    mockRoot = { id: EVENT_ID };
    await prefetchThread(EVENT_ID);
    expect(mockGetThread).not.toHaveBeenCalled();
  });

  it('fetches one note once per data-layer instance', async () => {
    await prefetchThread(EVENT_ID);
    await prefetchThread(EVENT_ID);
    expect(mockGetThread).toHaveBeenCalledTimes(1);
  });

  it('lets a later visit retry a read every tier refused', async () => {
    mockGetThread.mockResolvedValueOnce(served({ status: 'unavailable' }));
    await prefetchThread(EVENT_ID);
    await prefetchThread(EVENT_ID);
    expect(mockGetThread).toHaveBeenCalledTimes(2);
  });

  it('never leaks a thrown read to the card that asked for it', async () => {
    mockGetThread.mockRejectedValueOnce(new Error('offline'));
    await expect(prefetchThread(EVENT_ID)).resolves.toBeUndefined();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });
});
