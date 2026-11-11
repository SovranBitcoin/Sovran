/** @jest-environment node */
/**
 * Every move a writer of the redeem queue makes, and what each reader makes of
 * every kind of entry. The writers are the Bluetooth and message intakes, the
 * orchestrator's drain, "try again" and "receive all" (`requeue`), and the
 * parked-entry reconcile. These are the moves the queue must keep accepting.
 */
import {
  hasDrainableMessageEcash,
  hasDueMessageEcash,
  nextMessageEcashRetryAt,
  parkedMessageEcash,
  unclaimedMessageEcash,
} from '@/features/payments/lib/parkedMessageEcash';
import { useNutDropRedeemQueueStore } from '@/shared/stores/profile/nutDropRedeemQueueStore';

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
  getActiveProfilePubkey: () => 'a'.repeat(64),
}));

type Entry = ReturnType<typeof useNutDropRedeemQueueStore.getState>['byTokenHash'][string];

const HASH = 'f'.repeat(64);
const MINT = 'https://mint.test';
const NOW = 1_800_000_000_000;

const store = () => useNutDropRedeemQueueStore.getState();
const current = () => store().byTokenHash[HASH];

function at(status: Entry['status'], fields: Partial<Entry> = {}): void {
  useNutDropRedeemQueueStore.setState({
    byTokenHash: {
      [HASH]: {
        token: 'cashuBexample',
        mintUrl: MINT,
        amount: 21,
        unit: 'sat',
        status,
        attempts: 0,
        nextAttemptAt: 0,
        receivedAt: NOW - 1000,
        source: 'nostr',
        ...fields,
      },
    },
  });
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  useNutDropRedeemQueueStore.setState({ byTokenHash: {} });
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('moves the queue accepts', () => {
  it('queues a new token as waiting, never tried', () => {
    expect(
      store().enqueue(HASH, { token: 't', mintUrl: MINT, amount: 1, unit: 'sat', source: 'nostr' })
    ).toBe(true);
    expect(current()).toMatchObject({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      receivedAt: NOW,
    });
  });

  it.each([
    // [writer, from, call, expected status]
    [
      'message intake: probe says spent',
      'pending',
      () => store().markStatus(HASH, 'spent'),
      'spent',
    ],
    [
      'message intake: mint not trusted',
      'pending',
      () => store().markStatus(HASH, 'untrusted-mint'),
      'untrusted-mint',
    ],
    [
      'drain: starts a receive',
      'pending',
      () => store().markStatus(HASH, 'redeeming'),
      'redeeming',
    ],
    [
      'drain: resumes an interrupted receive',
      'redeeming',
      () => store().markStatus(HASH, 'redeeming'),
      'redeeming',
    ],
    [
      'drain: mint not trusted',
      'pending',
      () => store().markStatus(HASH, 'untrusted-mint'),
      'untrusted-mint',
    ],
    [
      'drain: interrupted entry, mint not trusted',
      'redeeming',
      () => store().markStatus(HASH, 'untrusted-mint'),
      'untrusted-mint',
    ],
    ['drain: received', 'redeeming', () => store().markStatus(HASH, 'redeemed'), 'redeemed'],
    [
      'drain: mint says spent',
      'redeeming',
      () => store().markStatus(HASH, 'spent', 'Token already spent'),
      'spent',
    ],
    [
      'drain: mint refused it',
      'redeeming',
      () => store().markStatus(HASH, 'failed', 'bad signature'),
      'failed',
    ],
    [
      'drain: trust lookup failed',
      'pending',
      () => store().scheduleRetry(HASH, 'unreachable'),
      'pending',
    ],
    [
      'drain: network failure',
      'redeeming',
      () => store().scheduleRetry(HASH, 'timeout'),
      'pending',
    ],
    ['receive all / try again', 'untrusted-mint', () => store().requeue(HASH), 'pending'],
    ['receive all / try again', 'failed', () => store().requeue(HASH), 'pending'],
    [
      'reconcile: redeemed by hand',
      'untrusted-mint',
      () => store().markStatus(HASH, 'spent'),
      'spent',
    ],
    ['reconcile: redeemed by hand', 'failed', () => store().markStatus(HASH, 'spent'), 'spent'],
    [
      'drain: received after a probe already called it spent',
      'spent',
      () => store().markStatus(HASH, 'redeemed'),
      'redeemed',
    ],
  ] as const)('%s: %s → %s', (_writer, from, call, to) => {
    at(from);
    call();
    expect(current()?.status).toBe(to);
    expect(current()?.token).toBe('cashuBexample');
  });

  it('backs off a retry, and gives up after the fifth attempt', () => {
    at('redeeming', { attempts: 4 });
    store().scheduleRetry(HASH, 'timeout');
    expect(current()).toMatchObject({ status: 'failed', attempts: 5, lastError: 'timeout' });

    at('redeeming', { attempts: 1 });
    store().scheduleRetry(HASH, 'timeout');
    expect(current()).toMatchObject({
      status: 'pending',
      attempts: 2,
      nextAttemptAt: NOW + 60_000,
    });
  });

  it('keeps the attempt count when the mint refuses a token', () => {
    at('redeeming', { attempts: 2 });
    store().markStatus(HASH, 'failed', 'bad signature');
    expect(current()).toMatchObject({ status: 'failed', attempts: 2, lastError: 'bad signature' });
  });

  it('puts a parked entry back in line with a clean slate', () => {
    at('failed', { attempts: 5, nextAttemptAt: NOW + 5000, lastError: 'timeout' });
    store().requeue(HASH);
    expect(current()).toMatchObject({ status: 'pending', attempts: 0, nextAttemptAt: 0 });
    expect(current()).not.toHaveProperty('lastError');
  });
});

describe('what each reader makes of an entry', () => {
  // [name, status, fields]
  const KINDS = [
    ['waiting, due', 'pending', {}],
    ['backing off', 'pending', { attempts: 1, nextAttemptAt: NOW + 30_000 }],
    ['retry time passed', 'pending', { attempts: 1, nextAttemptAt: NOW - 1 }],
    ['redeeming', 'redeeming', {}],
    ['redeemed', 'redeemed', { attempts: 1 }],
    ['spent', 'spent', {}],
    ['untrusted mint', 'untrusted-mint', { attempts: 1 }],
    ['refused by the mint', 'failed', { attempts: 2 }],
    ['out of retries', 'failed', { attempts: 5 }],
  ] as const;

  const read = () => {
    const entries = store().byTokenHash;
    return {
      parked: parkedMessageEcash(entries).map((entry) => entry.reason),
      unclaimed: unclaimedMessageEcash(entries, MINT, 'sat').map((entry) => entry.state),
      drainable: hasDrainableMessageEcash(entries),
      due: hasDueMessageEcash(entries, NOW),
      retryAt: nextMessageEcashRetryAt(entries),
    };
  };

  it.each([
    [
      'waiting, due',
      { parked: [], unclaimed: ['receiving'], drainable: true, due: true, retryAt: null },
    ],
    [
      'backing off',
      { parked: [], unclaimed: ['receiving'], drainable: true, due: false, retryAt: NOW + 30_000 },
    ],
    [
      'retry time passed',
      { parked: [], unclaimed: ['receiving'], drainable: true, due: true, retryAt: NOW - 1 },
    ],
    [
      'redeeming',
      { parked: [], unclaimed: ['receiving'], drainable: true, due: false, retryAt: null },
    ],
    ['redeemed', { parked: [], unclaimed: [], drainable: false, due: false, retryAt: null }],
    ['spent', { parked: [], unclaimed: [], drainable: false, due: false, retryAt: null }],
    [
      'untrusted mint',
      {
        parked: ['untrusted-mint'],
        unclaimed: ['untrusted-mint'],
        drainable: false,
        due: false,
        retryAt: null,
      },
    ],
    [
      'refused by the mint',
      { parked: ['failed'], unclaimed: ['failed'], drainable: false, due: false, retryAt: null },
    ],
    [
      'out of retries',
      { parked: ['failed'], unclaimed: ['failed'], drainable: false, due: false, retryAt: null },
    ],
  ] as const)('%s', (name, expected) => {
    const kind = KINDS.find(([kindName]) => kindName === name);
    if (!kind) throw new Error(`no kind ${name}`);
    at(kind[1], kind[2]);
    expect(read()).toEqual(expected);
  });

  it('ignores every entry that came over Bluetooth', () => {
    for (const [, status, fields] of KINDS) {
      at(status, { ...fields, source: 'ble' });
      expect(read()).toEqual({
        parked: [],
        unclaimed: [],
        drainable: false,
        due: false,
        retryAt: null,
      });
    }
  });
});
