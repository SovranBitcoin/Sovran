/** @jest-environment node */
import {
  cachedProbe,
  probeProviders,
  resolveProviderStatus,
} from '@/shared/lib/routstr/providerHealth';

jest.mock('@/shared/lib/nostr/client', () => ({ npubToPubkey: () => null }));
jest.mock('@/shared/lib/http/requestSignal', () => ({
  buildAbortSignal: ({ signal }: { signal?: AbortSignal }) => signal,
}));

afterEach(() => jest.restoreAllMocks());

it('reports a responding provider with non-JSON info as unknown', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>unsupported</html>'));
  const onResult = jest.fn();
  await probeProviders(['https://non-json.example'], { onResult });
  expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: 'unknown' }));
});

it.each([
  [200, 'online'],
  [404, 'unknown'],
  [503, 'offline'],
])(
  'reports HTTP %s as %s without confusing unsupported info with offline',
  async (status, expected) => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: Number(status) }));
    const onResult = jest.fn();
    await probeProviders([`https://status-${status}.example`], { onResult });
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ status: expected }));
  }
);

it('does not publish or cache an aborted lookup as an offline provider', async () => {
  const controller = new AbortController();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    controller.abort();
    throw new Error('aborted');
  });
  const onResult = jest.fn();
  await probeProviders(['https://aborted.example'], { signal: controller.signal, onResult });
  expect(onResult).not.toHaveBeenCalled();
  expect(cachedProbe('https://aborted.example')).toBeUndefined();
});

describe('server evidence vs. our own', () => {
  it.each([
    // What this device saw wins outright, in both directions: nagg probes on a
    // schedule from a data centre, and both of its answers can be stale or
    // network-path-specific.
    ['offline', 'online', 'offline'],
    ['online', 'offline', 'online'],
  ] as const)('local %s over server %s reads %s', (local, server, expected) => {
    expect(resolveProviderStatus(local, server)).toBe(expected);
  });

  it.each([
    // `unknown` is the absence of evidence, never a vote. A local probe that
    // could not tell (an old node with no `/v1/info`) leaves the server's
    // answer standing; the server's own `unknown` means it has not looked.
    [undefined, 'online', 'online'],
    ['unknown', 'offline', 'offline'],
    ['online', undefined, 'online'],
    [undefined, undefined, 'unknown'],
    ['unknown', 'unknown', 'unknown'],
    ['unknown', undefined, 'unknown'],
  ] as const)('local %s with server %s reads %s', (local, server, expected) => {
    expect(resolveProviderStatus(local, server)).toBe(expected);
  });
});
