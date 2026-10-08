import { verifyNip05 } from 'wallet';
import { cachedNip05Check, checkNip05Identity } from '@/shared/lib/nostr/profile/nip05Verification';

jest.mock('wallet', () => ({ ...jest.requireActual('wallet'), verifyNip05: jest.fn() }));
const pubkey = 'a'.repeat(64);
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

it('never reuses a verified claim for a different recipient key', async () => {
  jest.mocked(verifyNip05).mockImplementation(async (identifier, key) => ({
    status: key === pubkey ? 'verified' : 'mismatch',
    identifier,
  }));
  const first = await checkNip05Identity('alice@pair.example', pubkey);
  const other = await checkNip05Identity('alice@pair.example', 'b'.repeat(64));
  expect(first.result.status).toBe('verified');
  expect(other.result.status).toBe('mismatch');
  expect((await checkNip05Identity('ALICE@PAIR.EXAMPLE', pubkey)).result.status).toBe('verified');
  expect(verifyNip05).toHaveBeenCalledTimes(2);
});

it('expires cached trust and obtains a new domain assertion', async () => {
  jest.useFakeTimers();
  jest
    .mocked(verifyNip05)
    .mockResolvedValue({ status: 'verified', identifier: 'alice@expiry.example' });
  const first = await checkNip05Identity('alice@expiry.example', pubkey);
  jest.setSystemTime(first.expiresAt);
  expect(cachedNip05Check('alice@expiry.example', pubkey)).toBeUndefined();
  jest
    .mocked(verifyNip05)
    .mockResolvedValue({ status: 'mismatch', identifier: 'alice@expiry.example' });
  expect((await checkNip05Identity('alice@expiry.example', pubkey)).result.status).toBe('mismatch');
});

it('deduplicates concurrent checks and bounds network concurrency', async () => {
  let active = 0;
  let peak = 0;
  jest.mocked(verifyNip05).mockImplementation(async (identifier) => {
    active += 1;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return { status: 'verified', identifier };
  });
  const jobs = Array.from({ length: 12 }, (_, i) =>
    checkNip05Identity(`person${i}@queue.example`, pubkey)
  );
  const duplicate = checkNip05Identity('person0@queue.example', pubkey);
  const entries = await Promise.all([...jobs, duplicate]);
  expect(entries.every((entry) => entry.result.status === 'verified')).toBe(true);
  expect(verifyNip05).toHaveBeenCalledTimes(12);
  expect(peak).toBeLessThanOrEqual(4);
  expect(entries[0]).toBe(entries[12]);
});

describe('a verified mapping that cannot be re-checked', () => {
  const identifier = 'alice@refresh.example';

  it('stays verified through an unreachable refresh, until its hard expiry', async () => {
    jest.useFakeTimers();
    jest.mocked(verifyNip05).mockResolvedValue({ status: 'verified', identifier });
    const first = await checkNip05Identity(identifier, pubkey);
    expect(first.staleAt).toBeLessThan(first.expiresAt);

    jest.setSystemTime(first.staleAt + 1);
    jest.mocked(verifyNip05).mockResolvedValue({ status: 'error', reason: 'network' });
    const refreshed = await checkNip05Identity(identifier, pubkey, { refresh: true });

    expect(refreshed.result.status).toBe('verified');
    // The unreachable check buys a retry, never more trust.
    expect(refreshed.expiresAt).toBe(first.expiresAt);
    expect(cachedNip05Check(identifier, pubkey)?.result.status).toBe('verified');

    jest.setSystemTime(first.expiresAt);
    expect(cachedNip05Check(identifier, pubkey)).toBeUndefined();
  });

  it('is removed at once when the domain answers with a different key', async () => {
    jest.useFakeTimers();
    const address = 'alice@contradiction.example';
    jest.mocked(verifyNip05).mockResolvedValue({ status: 'verified', identifier: address });
    await checkNip05Identity(address, pubkey);

    jest.mocked(verifyNip05).mockResolvedValue({ status: 'mismatch', identifier: address });
    const refreshed = await checkNip05Identity(address, pubkey, { refresh: true });

    expect(refreshed.result.status).toBe('mismatch');
    expect(cachedNip05Check(address, pubkey)?.result.status).toBe('mismatch');
  });
});

it('does not record a failure for an identity it was too busy to check', async () => {
  jest.useRealTimers();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.mocked(verifyNip05).mockImplementation(async (identifier) => {
    await gate;
    return { status: 'verified', identifier };
  });
  const inFlight = Array.from({ length: 64 }, (_, i) =>
    checkNip05Identity(`busy${i}@overload.example`, pubkey)
  );

  await checkNip05Identity('late@overload.example', pubkey);
  expect(cachedNip05Check('late@overload.example', pubkey)).toBeUndefined();

  release();
  await Promise.all(inFlight);
});
