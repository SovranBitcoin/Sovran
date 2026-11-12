import {
  NUT_DROP_QUEUE_LIMITS,
  useNutDropRedeemQueueStore,
} from '@/shared/stores/profile/nutDropRedeemQueueStore';
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

  it.each([
    ['token', { token: 'c'.repeat(NUT_DROP_QUEUE_LIMITS.token + 1) }],
    ['mint address', { mintUrl: `https://${'m'.repeat(NUT_DROP_QUEUE_LIMITS.mintUrl)}` }],
    ['unit', { unit: 'u'.repeat(NUT_DROP_QUEUE_LIMITS.unit + 1) }],
    ['amount', { amount: Number.MAX_SAFE_INTEGER + 2 }],
  ])('refuses to save an entry whose %s is over the queue limits', (_what, over) => {
    // The reader takes any length a release saved; new entries still fit the limits.
    expect(useNutDropRedeemQueueStore.getState().enqueue(HASH, { ...ENTRY, ...over })).toBe(false);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash).toEqual({});
  });

  it('refuses an entry whose key is longer than a token hash', () => {
    const key = 'f'.repeat(NUT_DROP_QUEUE_LIMITS.tokenHash + 1);
    expect(useNutDropRedeemQueueStore.getState().enqueue(key, ENTRY)).toBe(false);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash).toEqual({});
  });

  it('saves an entry exactly at every limit', () => {
    const atLimit = {
      token: 'c'.repeat(NUT_DROP_QUEUE_LIMITS.token),
      mintUrl: 'm'.repeat(NUT_DROP_QUEUE_LIMITS.mintUrl),
      unit: 'u'.repeat(NUT_DROP_QUEUE_LIMITS.unit),
      amount: Number.MAX_SAFE_INTEGER,
    };
    expect(useNutDropRedeemQueueStore.getState().enqueue(HASH, atLimit)).toBe(true);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]).toMatchObject(atLimit);
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

  it('stores an error no longer than the stored queue allows', () => {
    // A mint or proxy can answer with a whole page. One entry past its limit
    // fails the persisted queue's schema, and with it every other entry.
    const page = 'x'.repeat(5_000);
    useNutDropRedeemQueueStore.getState().enqueue(HASH, ENTRY);
    useNutDropRedeemQueueStore.getState().scheduleRetry(HASH, page);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]?.lastError).toHaveLength(500);
    useNutDropRedeemQueueStore.getState().markStatus(HASH, 'redeeming');
    useNutDropRedeemQueueStore.getState().markStatus(HASH, 'failed', page);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]?.lastError).toHaveLength(500);
  });

  it('marks statuses and records errors', () => {
    useNutDropRedeemQueueStore.getState().enqueue(HASH, ENTRY);
    // The mint's "spent" answers a receive the drain started.
    useNutDropRedeemQueueStore.getState().markStatus(HASH, 'redeeming');
    useNutDropRedeemQueueStore.getState().markStatus(HASH, 'spent', 'already spent');
    expect(useNutDropRedeemQueueStore.getState().byTokenHash[HASH]).toMatchObject({
      status: 'spent',
      lastError: 'already spent',
    });
    // Unknown hash is a no-op.
    useNutDropRedeemQueueStore.getState().markStatus('0'.repeat(64), 'redeemed');
    expect(Object.keys(useNutDropRedeemQueueStore.getState().byTokenHash)).toHaveLength(1);
  });

  it('prunes settled entries but retains old unredeemed recovery material', () => {
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
    expect(remaining).toEqual(['a'.repeat(64), 'c'.repeat(64)]);
    expect(useNutDropRedeemQueueStore.getState().byTokenHash['c'.repeat(64)].token).toBe(
      ENTRY.token
    );
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
