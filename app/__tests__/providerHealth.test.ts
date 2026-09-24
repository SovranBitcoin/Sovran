/** @jest-environment node */
import { cachedProbe, probeProviders } from '@/shared/lib/routstr/providerHealth';

jest.mock('@/shared/lib/nostr/client', () => ({ npubToPubkey: () => null }));
jest.mock('@/shared/lib/http/requestSignal', () => ({
  buildAbortSignal: ({ signal }: { signal?: AbortSignal }) => signal,
}));

afterEach(() => jest.restoreAllMocks());

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
