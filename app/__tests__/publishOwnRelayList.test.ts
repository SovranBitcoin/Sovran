/**
 * @jest-environment node
 *
 * Network settings' "Publish relay list" (`publishRelayList`) against the real
 * relay-list store: what it sends, to which relays, how it is dated, and what
 * it records. Replaced: the publish seam, storage and the logger.
 */
import type NDK from '@nostr-dev-kit/ndk-mobile';
import { errAsync, okAsync } from 'neverthrow';

import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { publishRelayList } from '@/shared/lib/nostr/outbox/publishOwnRelayList';
import { useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';

const mockPublish = jest.fn();

jest.mock('@nostr-dev-kit/ndk-mobile', () => ({
  ...jest.requireActual('@nostr-dev-kit/ndk-mobile'),
  NDKEvent: class NDKEvent {
    kind = 0;
    created_at = 0;
    tags: string[][] = [];
  },
}));
jest.mock('@/shared/lib/nostr/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublish(...args),
}));
jest.mock('@/shared/lib/logger', () => {
  // Every export is a silent logger that is also callable (`redactError`, hooks).
  const silent: object = new Proxy(() => undefined, { get: () => silent });
  return new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : silent) });
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const NOW_SEC = 1_790_000_000;
const MINE = 'wss://mine.example';
const ndk = { pool: {} } as unknown as NDK;
const store = () => useRelayListStore.getState();

function publish() {
  const messages: (string | null)[] = [];
  const publishing: boolean[] = [];
  return publishRelayList({
    ndk,
    entries: store().entries,
    markPublished: store().markPublished,
    setPublishing: (value) => publishing.push(value),
    setPublishMsg: (message) => messages.push(message),
  }).then(() => ({ messages, publishing }));
}

const sent = () => mockPublish.mock.calls[0][0];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_SEC * 1000 });
  mockPublish.mockReset();
  mockPublish.mockReturnValue(okAsync({ accepted: [{ url: MINE }, { url: DEFAULT_RELAYS[0] }] }));
  useRelayListStore.setState({
    entries: [{ url: MINE, read: true, write: true }],
    updatedAt: 100,
    hasPublished: true,
    source: 'local',
    discoveredFor: null,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('publishing the relay list from Network settings', () => {
  it('sends the edited list to its write relays and the defaults, and records it as published', async () => {
    const { messages, publishing } = await publish();

    expect(sent().event).toMatchObject({ kind: 10002, tags: [['r', MINE]] });
    expect(sent().relays).toEqual([MINE, ...DEFAULT_RELAYS]);
    expect(sent().resolveOn).toBe('all-settled');
    expect(store()).toMatchObject({ source: 'relay', hasPublished: true, updatedAt: NOW_SEC });
    expect(messages).toEqual([null, 'Published to 2 relays.']);
    expect(publishing).toEqual([true, false]);
  });

  it('keeps the edit unpublished and says so when no relay accepts it', async () => {
    mockPublish.mockReturnValue(errAsync({ type: 'all-failed', relayResults: [] }));
    const { messages } = await publish();

    expect(store()).toMatchObject({ source: 'local', updatedAt: 100 });
    expect(messages).toEqual([null, 'Could not publish. Check your connection and try again.']);
  });

  it('dates the list now, even when the list it replaces is dated later', async () => {
    useRelayListStore.setState({ updatedAt: NOW_SEC + 600 });
    await publish();

    // QUIRK (F240 D3): relays keep the later list, while this one is recorded
    // as published and lowers the saved time.
    expect(sent().event.created_at).toBe(NOW_SEC);
    expect(store().updatedAt).toBe(NOW_SEC);
  });

  it('publishes an empty list once every relay is removed', async () => {
    store().removeRelay(MINE);
    await publish();

    // QUIRK (F240 D4): others find no relay for the account, while this phone
    // keeps writing to the defaults.
    expect(sent().event.tags).toEqual([]);
    expect(sent().relays).toEqual([...DEFAULT_RELAYS]);
  });
});
