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
