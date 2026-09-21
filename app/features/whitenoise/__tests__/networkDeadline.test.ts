import type NDK from '@nostr-dev-kit/ndk-mobile';

import { createWhitenoiseNetwork } from '@/features/whitenoise/client/network';

jest.mock(
  '@nostr-dev-kit/ndk-mobile',
  () => ({
    __esModule: true,
    default: class {},
    NDKEvent: class {},
    NDKRelaySet: { fromRelayUrls: jest.fn(() => ({})) },
    normalizeRelayUrl: (url: string) => url,
  }),
  { virtual: true }
);

const pending = () => new Promise<never>(() => {});

describe('whitenoise network one-shot reads', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('rejects a request whose relays never reach EOSE instead of hanging', async () => {
    const ndk = { fetchEvents: jest.fn(pending) } as unknown as NDK;
    const network = createWhitenoiseNetwork(ndk, ['wss://relay.example']);

    const settled = expect(network.request([], [{ kinds: [443] }])).rejects.toMatchObject({
      name: 'WhitenoiseRelayTimeoutError',
    });
    jest.advanceTimersByTime(10_000);
    await settled;
  });

  it('returns the events when the relays answer inside the deadline', async () => {
    const ndk = { fetchEvents: jest.fn(async () => new Set()) } as unknown as NDK;
    const network = createWhitenoiseNetwork(ndk, ['wss://relay.example']);

    await expect(network.request([], [{ kinds: [443] }])).resolves.toEqual([]);
    expect(jest.getTimerCount()).toBe(0);
  });
});
