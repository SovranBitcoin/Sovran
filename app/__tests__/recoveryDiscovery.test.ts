/** @jest-environment node */
import { ok, err } from 'neverthrow';
import type { DiscoverMint, discoverMints } from '@/shared/lib/apiClient';
import {
  fetchDiscoveredMintUrls,
  isAllowedMintHost,
  MAX_DISCOVERED_MINTS,
} from '@/features/settings/lib/recoveryDiscovery';

const row = (mintUrl: string, overrides: Partial<DiscoverMint> = {}): DiscoverMint => ({
  mintUrl,
  averageScore: null,
  reviewCount: 0,
  hasAudit: true,
  state: 'OK',
  ...overrides,
});

const transport = (mints: DiscoverMint[]) =>
  jest.fn<ReturnType<typeof discoverMints>, Parameters<typeof discoverMints>>(async () =>
    ok({ mints })
  );

describe('recovery discovery', () => {
  it.each([
    'localhost',
    'LOCALHOST',
    'mint.localhost',
    'mint.local',
    'mint.local.',
    'mint.internal',
    'mint.onion',
    '127.0.0.1',
    '192.168.1.1',
    '8.8.8.8',
    '[::1]',
    'mint.example:443',
    'mint',
  ])('rejects host %s', (host) => {
    expect(isAllowedMintHost(host)).toBe(false);
  });

  it('admits audited OK mints only, keeping the first URL and excluding known mints', async () => {
    const fetchMints = transport([
      row('https://known.example/'),
      row('https://MINT.example/'),
      row('https://mint.example'),
      row('https://mint.example/cashu/'),
      row('https://mint.example/cashu'),
      row('https://unaudited.example', { hasAudit: false }),
      row('https://unknown.example', { hasAudit: undefined }),
      row('https://failed.example', { state: 'ERROR' }),
      row('https://missing.example', { state: undefined }),
    ]);
    await expect(fetchDiscoveredMintUrls(['https://KNOWN.example'], fetchMints)).resolves.toEqual([
      'https://mint.example',
      'https://mint.example/cashu',
    ]);
  });

  it.each([
    'http://mint.example',
    'https://localhost',
    'https://mint.local',
    'https://mint.onion',
    'https://127.0.0.1',
    'https://2130706433',
    'https://0x7f000001',
    'https://[::1]',
    'https://mint.example:3338',
    'https://mint.example:443',
    'https://user@mint.example',
    'https://mint.example?target=localhost',
    'https://mint.example#fragment',
    'https://',
  ])('never returns unsafe URL %s', async (url) => {
    await expect(fetchDiscoveredMintUrls([], transport([row(url)]))).resolves.toEqual([]);
  });

  it('caps distinct admitted URLs after filtering', async () => {
    const mints = Array.from({ length: MAX_DISCOVERED_MINTS + 20 }, (_, i) =>
      row(`https://mint${i}.example`)
    );
    const urls = await fetchDiscoveredMintUrls(
      [],
      transport([row('https://localhost'), mints[0]!, ...mints])
    );
    expect(urls).toHaveLength(MAX_DISCOVERED_MINTS);
    expect(new Set(urls).size).toBe(MAX_DISCOVERED_MINTS);
    expect(urls.at(-1)).toBe(`https://mint${MAX_DISCOVERED_MINTS - 1}.example`);
  });

  it('does not admit mints when discovery fails', async () => {
    const fetchMints = jest.fn<ReturnType<typeof discoverMints>, Parameters<typeof discoverMints>>(
      async () => err(new Error('Discovery unavailable'))
    );
    await expect(fetchDiscoveredMintUrls([], fetchMints)).resolves.toEqual([]);
  });

  it('does not fetch when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMints = transport([]);
    await expect(fetchDiscoveredMintUrls([], fetchMints, controller.signal)).resolves.toEqual([]);
    expect(fetchMints).not.toHaveBeenCalled();
  });

  it('forwards cancellation and discards a late response even if transport ignores abort', async () => {
    const controller = new AbortController();
    let resolve!: (value: { mints: DiscoverMint[] }) => void;
    const response = new Promise<{ mints: DiscoverMint[] }>((done) => {
      resolve = done;
    });
    const fetchMints = jest.fn<ReturnType<typeof discoverMints>, Parameters<typeof discoverMints>>(
      async () => ok(await response)
    );
    const pending = fetchDiscoveredMintUrls([], fetchMints, controller.signal);
    expect(fetchMints).toHaveBeenCalledWith({ signal: controller.signal });
    controller.abort();
    resolve({ mints: [row('https://mint.example')] });
    await expect(pending).resolves.toEqual([]);
  });
});
