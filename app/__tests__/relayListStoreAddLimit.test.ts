/**
 * @jest-environment node
 *
 * The relay list's write limit. The reader takes a list of any length (0.1.3
 * appended without a cap); a new distinct relay is refused once the list
 * holds 64, and editing or re-adding one already there always works.
 */

import { MAX_RELAYS, useRelayListStore } from '@/shared/lib/nostr/outbox/relayListStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

const relay = (i: number) => `wss://relay${i}.example.com`;
const BOTH = { read: true, write: true };
const urls = () => useRelayListStore.getState().entries.map((e) => e.url);

function holding(count: number) {
  useRelayListStore.setState({
    entries: Array.from({ length: count }, (_, i) => ({ url: relay(i), ...BOTH })),
    source: 'relay',
  });
}

beforeEach(() => holding(0));

it('adds the 64th relay and refuses a 65th distinct one', () => {
  expect(MAX_RELAYS).toBe(64);
  holding(63);
  expect(useRelayListStore.getState().addRelay(relay(63), BOTH)).toBe(true);
  expect(urls()).toHaveLength(64);
  useRelayListStore.setState({ source: 'relay' });

  expect(useRelayListStore.getState().addRelay(relay(64), BOTH)).toBe(false);
  expect(urls()).toEqual(Array.from({ length: 64 }, (_, i) => relay(i)));
  // A refusal changes nothing, so the list is not marked as needing a publish.
  expect(useRelayListStore.getState().source).toBe('relay');
});

it('re-adds or edits a relay already in a full list', () => {
  holding(64);
  expect(useRelayListStore.getState().addRelay(relay(5), { read: false, write: true })).toBe(true);
  useRelayListStore.getState().setMarker(relay(6), { read: true, write: false });

  expect(urls()).toHaveLength(64);
  const entry = (url: string) => useRelayListStore.getState().entries.find((e) => e.url === url);
  expect(entry(relay(5))).toEqual({ url: relay(5), read: false, write: true });
  expect(entry(relay(6))).toEqual({ url: relay(6), read: true, write: false });
});

it('does not let a marker change add a relay past the limit', () => {
  holding(64);
  useRelayListStore.getState().setMarker(relay(64), BOTH);
  expect(urls()).not.toContain(relay(64));
  expect(urls()).toHaveLength(64);
});

it('keeps a longer list saved by an earlier release whole, and editable', () => {
  holding(65);
  useRelayListStore.getState().setMarker(relay(3), { read: true, write: false });
  expect(urls()).toHaveLength(65);
  expect(useRelayListStore.getState().entries.find((e) => e.url === relay(3))).toEqual({
    url: relay(3),
    read: true,
    write: false,
  });
  useRelayListStore.getState().removeRelay(relay(4));
  expect([...urls()].sort()).toEqual(
    Array.from({ length: 65 }, (_, i) => relay(i))
      .filter((url) => url !== relay(4))
      .sort()
  );
  // At the limit after one removal, so a new one is still refused.
  expect(useRelayListStore.getState().addRelay(relay(99), BOTH)).toBe(false);
  expect(urls()).toHaveLength(64);
});

it('takes a new relay again once a long list is back under the limit', () => {
  holding(65);
  useRelayListStore.getState().removeRelay(relay(0));
  useRelayListStore.getState().removeRelay(relay(1));
  expect(useRelayListStore.getState().addRelay(relay(99), BOTH)).toBe(true);
  expect(urls()).toHaveLength(64);
});
