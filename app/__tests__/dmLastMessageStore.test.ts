import { useDmLastMessageStore } from '@/shared/stores/profile/dmLastMessageStore';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
const mockWrite = jest.fn();
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: (...args: unknown[]) => mockWrite(...args),
    removeItem: async () => {},
  }),
}));

const peer = (index: number) => index.toString(16).padStart(64, '0');
const entry = { protocol: 'nip17' as const, atSeconds: 100, isOwn: false };
const schema = persistRegistry.find((item) => item.name === 'dm-last-message-store')!.schema;

beforeEach(async () => {
  await useDmLastMessageStore.persist.rehydrate();
  useDmLastMessageStore.setState({ byPeer: {} });
  mockWrite.mockClear();
});

it('writes only newer messages and preserves identity for ignored pages', () => {
  const { recordLastMessage } = useDmLastMessageStore.getState();
  recordLastMessage(peer(1), entry);
  const previous = useDmLastMessageStore.getState();
  recordLastMessage(peer(1), { ...entry, protocol: 'nip04', atSeconds: 99 });
  recordLastMessage(peer(1), { ...entry, isOwn: true });
  expect(useDmLastMessageStore.getState()).toBe(previous);
  expect(mockWrite).toHaveBeenCalledTimes(1);
  recordLastMessage(peer(1), { ...entry, protocol: 'nip04', atSeconds: 101, isOwn: true });
  expect(useDmLastMessageStore.getState().byPeer[peer(1)]).toEqual({
    protocol: 'nip04',
    atSeconds: 101,
    isOwn: true,
  });
  expect(mockWrite).toHaveBeenCalledTimes(2);
});

it('retains the newest 500 peers, including when older pages arrive later', () => {
  const { recordLastMessage } = useDmLastMessageStore.getState();
  for (let index = 501; index >= 1; index--) {
    recordLastMessage(peer(index), { ...entry, atSeconds: index });
  }
  const { byPeer } = useDmLastMessageStore.getState();
  expect(Object.keys(byPeer)).toHaveLength(500);
  expect(byPeer[peer(1)]).toBeUndefined();
  expect(byPeer[peer(501)]?.atSeconds).toBe(501);
  expect(mockWrite).toHaveBeenCalledTimes(500);
});

it.each([{}, { byPeer: null }, { byPeer: 'invalid' }])(
  'tolerates missing or malformed collections: %j',
  (stored) => {
    expect(schema.parse(stored)).toEqual({ byPeer: {} });
  }
);

it('drops invalid keys, timestamps and future protocols without losing valid peers', () => {
  expect(
    schema.parse({
      byPeer: {
        [peer(1)]: entry,
        [peer(2)]: { ...entry, protocol: 'future-transport' },
        [peer(3)]: { ...entry, atSeconds: -1 },
        invalid: entry,
      },
    })
  ).toEqual({ byPeer: { [peer(1)]: entry } });
});

it('bounds hydration and round-trips populated data without actions', () => {
  const byPeer = Object.fromEntries(
    Array.from({ length: 501 }, (_, index) => [peer(index), { ...entry, atSeconds: index }])
  );
  const parsed = schema.parse({ byPeer }) as { byPeer: typeof byPeer };
  expect(Object.keys(parsed.byPeer)).toHaveLength(500);
  expect(parsed.byPeer[peer(0)]).toBeUndefined();
  useDmLastMessageStore.getState().recordLastMessage(peer(1), entry);
  const options = useDmLastMessageStore.persist.getOptions();
  const stored = JSON.parse(JSON.stringify(options.partialize!(useDmLastMessageStore.getState())));
  expect(stored).toEqual({ byPeer: { [peer(1)]: entry } });
  expect(schema.parse(stored)).toEqual(stored);
});
