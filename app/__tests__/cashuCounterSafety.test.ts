/**
 * @jest-environment node
 */

import type {
  Counter,
  CounterRepository,
  Repositories,
  RepositoryTransactionScope,
} from '@cashu/coco-core/adapter';
import type { Manager } from '@cashu/coco-core';

import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';
import { overwriteCounter } from '@/shared/lib/cashu/managerInternals';

const MINT_URL = 'https://mint.example';

function counterRepository(delayed = false): CounterRepository & {
  rows: Map<string, Counter>;
  setCounter: jest.MockedFunction<CounterRepository['setCounter']>;
} {
  const rows = new Map<string, Counter>();
  const key = (mintUrl: string, keysetId: string) => `${mintUrl}\u0000${keysetId}`;
  const setCounter = jest.fn(async (mintUrl: string, keysetId: string, counter: number) => {
    if (delayed) {
      const delay = counter === 5 ? 30 : counter === 10 ? 20 : 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    rows.set(key(mintUrl, keysetId), { counter, keysetId, mintUrl });
  });
  return {
    rows,
    getCounter: jest.fn(async (mintUrl, keysetId) => rows.get(key(mintUrl, keysetId)) ?? null),
    setCounter,
  };
}

function repositoryScope(counter: CounterRepository): RepositoryTransactionScope {
  return {
    mintRepository: {},
    keyRingRepository: {},
    counterRepository: counter,
    keysetRepository: {},
    proofRepository: {},
    mintQuoteRepository: {},
    legacyMintQuoteRepository: {},
    meltQuoteRepository: {},
    historyRepository: {},
    sendOperationRepository: {},
    meltOperationRepository: {},
    authSessionRepository: {},
    mintOperationRepository: {},
    receiveOperationRepository: {},
    paymentRequestReceiveOperationRepository: {},
    paymentRequestReceiveAttemptRepository: {},
  } as unknown as RepositoryTransactionScope;
}

function repositories(counter: CounterRepository): Repositories {
  const scope = repositoryScope(counter);
  return {
    ...scope,
    init: jest.fn(),
    withTransaction: jest.fn(async (fn) => fn(scope)),
  } as unknown as Repositories;
}

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Sovran Coco counter repository boundary', () => {
  it('uses MAX-on-conflict so a stale replay cannot regress a high counter', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));

    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 100);
    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 20);

    await expect(wrapped.counterRepository.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject(
      { counter: 100 }
    );
    expect(delegate.setCounter).toHaveBeenCalledTimes(1);
  });

  it('advances each keyset independently while retaining a too-high keyset', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));

    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 10);
    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-b', 2);
    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 5);
    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-b', 7);

    await expect(wrapped.counterRepository.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject(
      { counter: 10 }
    );
    await expect(wrapped.counterRepository.getCounter(MINT_URL, 'keyset-b')).resolves.toMatchObject(
      { counter: 7 }
    );
  });

  it('serializes conflicting concurrent writes before applying the maximum', async () => {
    const delegate = counterRepository(true);
    const wrapped = createSovranCocoRepositories(repositories(delegate));

    await Promise.all([
      wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 10),
      wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 5),
      wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 20),
    ]);

    await expect(wrapped.counterRepository.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject(
      { counter: 20 }
    );
    expect(delegate.setCounter.mock.calls.map((call) => call[2])).toEqual([10, 20]);
  });

  it('applies the same monotonic guard inside repository transactions', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));
    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 50);

    await wrapped.withTransaction(async (scope) => {
      await scope.counterRepository.setCounter(MINT_URL, 'keyset-a', 3);
    });

    await expect(wrapped.counterRepository.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject(
      { counter: 50 }
    );
  });
});

describe('legacy counter migration boundary', () => {
  it('reads back the current high-water mark and ignores a stale migration value', async () => {
    let current = 42;
    const counterService = {
      getCounter: jest.fn(async () => ({
        counter: current,
        keysetId: 'keyset-a',
        mintUrl: MINT_URL,
      })),
      overwriteCounter: jest.fn(async (_mintUrl: string, _keysetId: string, counter: number) => {
        current = counter;
        return { counter, keysetId: 'keyset-a', mintUrl: MINT_URL };
      }),
    };
    const manager = Object.assign(Object.create(null), { counterService }) as Manager;

    await expect(overwriteCounter(manager, MINT_URL, 'keyset-a', 7)).resolves.toMatchObject({
      counter: 42,
    });
    expect(counterService.overwriteCounter).not.toHaveBeenCalled();

    await expect(overwriteCounter(manager, MINT_URL, 'keyset-a', 75)).resolves.toMatchObject({
      counter: 75,
    });
    expect(counterService.overwriteCounter).toHaveBeenCalledWith(MINT_URL, 'keyset-a', 75);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an invalid migration counter: %s',
    async (counter) => {
      const manager = Object.assign(Object.create(null), {
        counterService: { getCounter: jest.fn(), overwriteCounter: jest.fn() },
      }) as Manager;

      await expect(overwriteCounter(manager, MINT_URL, 'keyset-a', counter)).rejects.toThrow(
        'counter must be a non-negative safe integer'
      );
    }
  );
});
