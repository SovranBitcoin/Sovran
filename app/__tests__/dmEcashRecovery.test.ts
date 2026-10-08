/** @jest-environment node */
import {
  markMessageEcashReviewed,
  reconcileParkedMessageEcash,
} from '@/features/payments/lib/dmEcashRecovery';
import {
  hasDrainableMessageEcash,
  parkedMessageEcash,
} from '@/features/payments/lib/parkedMessageEcash';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

const mockIsTokenSpent = jest.fn();
const mockIsTrustedMint = jest.fn();
const mockManager = { mint: { isTrustedMint: (url: string) => mockIsTrustedMint(url) } };

jest.mock('@/shared/lib/routstr/spentProbe', () => ({
  isTokenSpent: (...args: unknown[]) => mockIsTokenSpent(...args),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { isInitialized: () => true, getInstance: () => mockManager },
}));

const ME = 'a'.repeat(64);
const SOMEONE_ELSE = 'b'.repeat(64);

const store = () => useNutDropRedeemQueueStore.getState();

function park(hash: string, status: 'untrusted-mint' | 'failed', source: 'nostr' | 'ble') {
  store().enqueue(hash, {
    token: `token-${hash}`,
    mintUrl: 'https://mint.example',
    amount: 21,
    unit: 'sat',
    source,
  });
  store().markStatus(hash, status, 'parked');
}

beforeEach(() => {
  useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
  mockIsTokenSpent.mockReset().mockResolvedValue(false);
  mockIsTrustedMint.mockReset().mockResolvedValue(false);
});

describe('message ecash the queue has parked', () => {
  it('lists only Nostr-delivered entries that will not move on their own', () => {
    park('a', 'untrusted-mint', 'nostr');
    park('b', 'failed', 'nostr');
    park('c', 'untrusted-mint', 'ble');
    store().enqueue('d', {
      token: 't',
      mintUrl: 'https://mint.example',
      amount: 1,
      unit: 'sat',
      source: 'nostr',
    });
    expect(parkedMessageEcash(store().byTokenHash).map((entry) => entry.tokenHash)).toEqual([
      'a',
      'b',
    ]);
  });

  it('puts an entry back in line once its mint is trusted', async () => {
    park('a', 'untrusted-mint', 'nostr');
    mockIsTrustedMint.mockResolvedValue(true);
    expect(await reconcileParkedMessageEcash(ME, () => true)).toBe(true);
    expect(store().byTokenHash.a).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('closes, rather than retries, a token redeemed by hand on a mint since trusted', async () => {
    // Opened from the review row, mint added, redeemed in the receive screen.
    // Going back in line would end in an "already redeemed" failure.
    park('a', 'untrusted-mint', 'nostr');
    mockIsTrustedMint.mockResolvedValue(true);
    mockIsTokenSpent.mockResolvedValue(true);
    expect(await reconcileParkedMessageEcash(ME, () => true)).toBe(false);
    expect(store().byTokenHash.a?.status).toBe('spent');
  });

  it('leaves an entry parked while its mint is still untrusted', async () => {
    park('a', 'untrusted-mint', 'nostr');
    expect(await reconcileParkedMessageEcash(ME, () => true)).toBe(false);
    expect(store().byTokenHash.a?.status).toBe('untrusted-mint');
  });

  it('never contacts an untrusted mint the person has not opened', async () => {
    park('a', 'untrusted-mint', 'nostr');
    park('b', 'failed', 'nostr');
    await reconcileParkedMessageEcash(ME, () => true);
    expect(mockIsTokenSpent).not.toHaveBeenCalled();
  });

  it('closes an entry redeemed by hand after the person opened it', async () => {
    park('opened', 'untrusted-mint', 'nostr');
    markMessageEcashReviewed(ME, 'opened');
    mockIsTokenSpent.mockResolvedValue(true);
    await reconcileParkedMessageEcash(ME, () => true);
    expect(store().byTokenHash.opened?.status).toBe('spent');
    expect(parkedMessageEcash(store().byTokenHash)).toEqual([]);
  });

  it('does not take another profile having opened a token as this one agreeing', async () => {
    park('shared', 'untrusted-mint', 'nostr');
    markMessageEcashReviewed(SOMEONE_ELSE, 'shared');
    await reconcileParkedMessageEcash(ME, () => true);
    expect(mockIsTokenSpent).not.toHaveBeenCalled();
  });

  it('closes a failed entry on a trusted mint once its token is spent', async () => {
    park('a', 'failed', 'nostr');
    mockIsTrustedMint.mockResolvedValue(true);
    mockIsTokenSpent.mockResolvedValue(true);
    await reconcileParkedMessageEcash(ME, () => true);
    expect(store().byTokenHash.a?.status).toBe('spent');
  });

  it('never retries a failed entry by itself', async () => {
    park('a', 'failed', 'nostr');
    mockIsTrustedMint.mockResolvedValue(true);
    expect(await reconcileParkedMessageEcash(ME, () => true)).toBe(false);
    expect(store().byTokenHash.a?.status).toBe('failed');
  });

  it('writes nothing once the wallet has changed', async () => {
    park('a', 'untrusted-mint', 'nostr');
    mockIsTrustedMint.mockResolvedValue(true);
    await reconcileParkedMessageEcash(ME, () => false);
    expect(store().byTokenHash.a?.status).toBe('untrusted-mint');
  });

  it('keeps reconciling after one mint cannot be reached', async () => {
    park('a', 'failed', 'nostr');
    park('b', 'failed', 'nostr');
    mockIsTrustedMint.mockResolvedValue(true);
    mockIsTokenSpent.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
    await reconcileParkedMessageEcash(ME, () => true);
    expect(store().byTokenHash.a?.status).toBe('failed');
    expect(store().byTokenHash.b?.status).toBe('spent');
  });

  it('counts an interrupted redeem as work still to drain', () => {
    store().enqueue('a', {
      token: 't',
      mintUrl: 'https://mint.example',
      amount: 1,
      unit: 'sat',
      source: 'nostr',
    });
    store().markStatus('a', 'redeeming');
    expect(hasDrainableMessageEcash(store().byTokenHash)).toBe(true);
    store().markStatus('a', 'redeemed');
    expect(hasDrainableMessageEcash(store().byTokenHash)).toBe(false);
  });
});

describe('requeue', () => {
  it('never revives a terminal entry', () => {
    park('a', 'failed', 'nostr');
    store().markStatus('a', 'spent');
    store().requeue('a');
    expect(store().byTokenHash.a?.status).toBe('spent');
  });
});
