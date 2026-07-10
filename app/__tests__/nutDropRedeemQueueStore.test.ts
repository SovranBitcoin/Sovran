import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';
import { persistRegistry } from '@/shared/lib/persist/persistConfig';

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

const HASH = 'f'.repeat(64);
const ENTRY = {
  token: 'cashuBexample',
  mintUrl: 'https://mint.test',
  amount: 21,
  unit: 'sat',
};

describe('nutDropRedeemQueueStore', () => {
  beforeEach(() => {
    useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
  });

  it('enqueues idempotently on token hash', () => {
    const store = useNutDropRedeemQueueStore.getState();
    expect(store.enqueue(HASH, ENTRY)).toBe(true);
    expect(useNutDropRedeemQueueStore.getState().enqueue(HASH, ENTRY)).toBe(false);

    const entry = useNutDropRedeemQueueStore.getState().byTokenHash[HASH];
    expect(entry).toMatchObject({ ...ENTRY, status: 'pending', attempts: 0, nextAttemptAt: 0 });
    expect(Object.keys(useNutDropRedeemQueueStore.getState().byTokenHash)).toHaveLength(1);
  });

  it('schedules retries with growing backoff and fails after max attempts', () => {
    useNutDropRedeemQueueStore.getState().enqueue(HASH, ENTRY);

    useNutDropRedeemQueueStore.getState().scheduleRetry(HASH, 'mint unreachable');
    const first = useNutDropRedeemQueueStore.getState().byTokenHash[HASH];
    expect(first.status).toBe('pending');
    expect(first.attempts).toBe(1);
    expect(first.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(first.lastError).toBe('mint unreachable');

    useNutDropRedeemQueueStore.getState().scheduleRetry(HASH, 'again');
    const second = useNutDropRedeemQueueStore.getState().byTokenHash[HASH];
    expect(second.attempts).toBe(2);
    expect(second.nextAttemptAt).toBeGreaterThan(first.nextAttemptAt);

    for (let i = 0; i < 3; i++) {
      useNutDropRedeemQueueStore.getState().scheduleRetry(HASH, 'still failing');
    }
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]).toMatchObject({
      status: 'failed',
      attempts: 5,
    });
  });

  it('marks statuses and records errors', () => {
    useNutDropRedeemQueueStore.getState().enqueue(HASH, ENTRY);
    useNutDropRedeemQueueStore.getState().markStatus(HASH, 'spent', 'already spent');
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]).toMatchObject({
      status: 'spent',
      lastError: 'already spent',
    });
    // Unknown hash is a no-op.
    useNutDropRedeemQueueStore.getState().markStatus('0'.repeat(64), 'redeemed');
    expect(Object.keys(useNutDropRedeemQueueStore.getState().byTokenHash)).toHaveLength(1);
  });

  it('prunes terminal entries faster than pending ones', () => {
    const dayMs = 24 * 60 * 60 * 1000;
    useNutDropRedeemQueueStore.setState({
      byTokenHash: {
        ['a'.repeat(64)]: {
          ...ENTRY,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: 0,
          receivedAt: Date.now() - 2 * dayMs,
        },
        ['b'.repeat(64)]: {
          ...ENTRY,
          status: 'redeemed',
          attempts: 1,
          nextAttemptAt: 0,
          receivedAt: Date.now() - 2 * dayMs,
        },
        ['c'.repeat(64)]: {
          ...ENTRY,
          status: 'pending',
          attempts: 0,
          nextAttemptAt: 0,
          receivedAt: Date.now() - 31 * dayMs,
        },
      },
    });

    useNutDropRedeemQueueStore.getState().prune();
    const remaining = Object.keys(useNutDropRedeemQueueStore.getState().byTokenHash);
    expect(remaining).toEqual(['a'.repeat(64)]);
  });

  it('degrades an unknown persisted status without discarding queued ecash', () => {
    const schema = persistRegistry.find((entry) => entry.name === 'nut-drop-redeem-queue')?.schema;
    if (!schema) throw new Error('nut-drop-redeem-queue missing from persistRegistry');

    const parsed = schema.parse({
      byTokenHash: {
        [HASH]: {
          ...ENTRY,
          status: 'future-retry-state',
          attempts: 2,
          nextAttemptAt: 123,
          receivedAt: 456,
        },
      },
    }) as { byTokenHash: Record<string, { token: string; status: string }> };

    expect(parsed.byTokenHash[HASH]).toMatchObject({
      token: ENTRY.token,
      status: 'pending',
    });
  });
});
