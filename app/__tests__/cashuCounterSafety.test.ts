/**
 * @jest-environment node
 */

import type {
  Counter,
  CounterRepository,
  Repositories,
  RepositoryTransactionScope,
} from '@cashu/coco-core/adapter';

import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';

const MINT_URL = 'https://mint.example';

function counterRepository(delayed = false): CounterRepository & {
  rows: Map<string, Counter>;
  setCounter: jest.MockedFunction<CounterRepository['setCounter']>;
} {
  const rows = new Map<string, Counter>();
  const key = (mintUrl: string, keysetId: string) => `${mintUrl}\u0000${keysetId}`;
  const setCounter = jest.fn(async (mintUrl: string, keysetId: string, counter: number) => {
    if (delayed) {
      const delayMs = counter === 5 ? 30 : counter === 10 ? 20 : 10;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    rows.set(key(mintUrl, keysetId), { counter, keysetId, mintUrl });
  });
  return {
    rows,
    getCounter: jest.fn(async (mintUrl, keysetId) => rows.get(key(mintUrl, keysetId)) ?? null),
    setCounter,
  };
}

/** Ready proofs held per keyset, as Coco's SQLite proof repository reports them. */
function proofRepository(heldKeysetIds: string[] = []) {
  return {
    getProofsByKeysetId: jest.fn(async (_mintUrl: string, keysetId: string) =>
      heldKeysetIds.includes(keysetId) ? [{ id: keysetId, secret: 'secret', state: 'ready' }] : []
    ),
  };
}

function repositoryScope(
  counter: CounterRepository,
  proofs = proofRepository()
): RepositoryTransactionScope {
  return {
    mintRepository: {},
    keyRingRepository: {},
    counterRepository: counter,
    keysetRepository: {},
    proofRepository: proofs,
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

function repositories(counter: CounterRepository, proofs = proofRepository()): Repositories {
  const scope = repositoryScope(counter, proofs);
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

/** Coco's CounterService, reduced to the repository calls it makes
 * (coco-core `services/CounterService.ts`). */
function cocoCounterService(repository: CounterRepository) {
  const getCounter = async (mintUrl: string, keysetId: string) => {
    const counter = await repository.getCounter(mintUrl, keysetId);
    if (counter) return counter;
    await repository.setCounter(mintUrl, keysetId, 0);
    return { mintUrl, keysetId, counter: 0 };
  };
  return {
    getCounter,
    incrementCounter: async (mintUrl: string, keysetId: string, n: number) => {
      const current = await getCounter(mintUrl, keysetId);
      await repository.setCounter(mintUrl, keysetId, current.counter + n);
    },
    /** What restore runs once the mint has returned at least one signature. */
    overwriteAfterRestore: async (
      mintUrl: string,
      keysetId: string,
      lastCounterWithSignature: number
    ) => {
      const newCounter = lastCounterWithSignature ? lastCounterWithSignature + 1 : 0;
      await repository.setCounter(mintUrl, keysetId, newCounter);
    },
  };
}

describe('restore that finds its only signature at counter 0', () => {
  it('stores 1, so the next output does not repeat the signed one', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));
    const coco = cocoCounterService(wrapped.counterRepository);

    // Coco writes the counter before it saves the restored proofs, and never
    // saves a spent one, so no proof is held at this point.
    await coco.overwriteAfterRestore(MINT_URL, 'keyset-a', 0);

    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-a`)).toMatchObject({ counter: 1 });
    await expect(coco.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject({ counter: 1 });
  });

  it('stores 1 when the wallet already tracked the keyset at 0', async () => {
    const delegate = counterRepository();
    await delegate.setCounter(MINT_URL, 'keyset-a', 0);
    const wrapped = createSovranCocoRepositories(
      repositories(delegate, proofRepository(['keyset-a']))
    );

    await cocoCounterService(wrapped.counterRepository).overwriteAfterRestore(
      MINT_URL,
      'keyset-a',
      0
    );

    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-a`)).toMatchObject({ counter: 1 });
  });

  it('leaves a later signature to Coco, which already adds one', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));

    await cocoCounterService(wrapped.counterRepository).overwriteAfterRestore(
      MINT_URL,
      'keyset-a',
      4
    );

    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-a`)).toMatchObject({ counter: 5 });
  });

  it('never lowers a higher counter', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));
    const coco = cocoCounterService(wrapped.counterRepository);
    await coco.incrementCounter(MINT_URL, 'keyset-a', 7);
    delegate.setCounter.mockClear();

    await coco.overwriteAfterRestore(MINT_URL, 'keyset-a', 0);

    await expect(coco.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject({ counter: 7 });
    expect(delegate.setCounter).not.toHaveBeenCalled();
  });

  it('does not touch other keysets', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));
    const coco = cocoCounterService(wrapped.counterRepository);
    await coco.incrementCounter(MINT_URL, 'keyset-b', 3);

    await coco.overwriteAfterRestore(MINT_URL, 'keyset-a', 0);

    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-b`)).toMatchObject({ counter: 3 });
    expect(delegate.rows.has(`${MINT_URL}\u0000keyset-c`)).toBe(false);
    await expect(coco.getCounter(MINT_URL, 'keyset-c')).resolves.toMatchObject({ counter: 0 });
  });

  it('applies inside repository transactions too', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));

    await wrapped.withTransaction(async (scope) => {
      await cocoCounterService(scope.counterRepository).overwriteAfterRestore(
        MINT_URL,
        'keyset-a',
        0
      );
    });

    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-a`)).toMatchObject({ counter: 1 });
  });
});

describe('a keyset with no outputs yet', () => {
  it('reads as 0 without a write, so the first output uses counter 0', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));
    const coco = cocoCounterService(wrapped.counterRepository);

    await expect(coco.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject({ counter: 0 });
    expect(delegate.setCounter).not.toHaveBeenCalled();
  });

  it('advances by exactly the outputs made, skipping nothing', async () => {
    const delegate = counterRepository();
    const wrapped = createSovranCocoRepositories(repositories(delegate));
    const coco = cocoCounterService(wrapped.counterRepository);

    await coco.incrementCounter(MINT_URL, 'keyset-a', 3);
    await coco.incrementCounter(MINT_URL, 'keyset-a', 2);

    await expect(coco.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject({ counter: 5 });
    expect(delegate.setCounter.mock.calls.map((call) => call[2])).toEqual([3, 5]);
  });
});

describe('a wallet an earlier build restored to counter 0', () => {
  it('reads as 1 while it holds a proof for that keyset', async () => {
    const delegate = counterRepository();
    await delegate.setCounter(MINT_URL, 'keyset-a', 0);
    await delegate.setCounter(MINT_URL, 'keyset-b', 0);
    const wrapped = createSovranCocoRepositories(
      repositories(delegate, proofRepository(['keyset-a']))
    );
    const coco = cocoCounterService(wrapped.counterRepository);

    await expect(coco.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject({ counter: 1 });
    await expect(coco.getCounter(MINT_URL, 'keyset-b')).resolves.toMatchObject({ counter: 0 });

    await coco.incrementCounter(MINT_URL, 'keyset-a', 2);
    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-a`)).toMatchObject({ counter: 3 });
  });

  it('stays at 1 after that proof has been sent and is no longer held', async () => {
    const delegate = counterRepository();
    await delegate.setCounter(MINT_URL, 'keyset-a', 0);
    const held = createSovranCocoRepositories(
      repositories(delegate, proofRepository(['keyset-a']))
    );
    await held.counterRepository.getCounter(MINT_URL, 'keyset-a');
    // Saved on that read, so it does not depend on the proof still being there.
    expect(delegate.rows.get(`${MINT_URL}\u0000keyset-a`)).toMatchObject({ counter: 1 });

    const sent = createSovranCocoRepositories(repositories(delegate, proofRepository([])));
    await expect(sent.counterRepository.getCounter(MINT_URL, 'keyset-a')).resolves.toMatchObject({
      counter: 1,
    });
  });

  it('does not look at proofs once the counter has moved', async () => {
    const delegate = counterRepository();
    const proofs = proofRepository(['keyset-a']);
    const wrapped = createSovranCocoRepositories(repositories(delegate, proofs));
    await wrapped.counterRepository.setCounter(MINT_URL, 'keyset-a', 9);

    await wrapped.counterRepository.getCounter(MINT_URL, 'keyset-a');

    expect(proofs.getProofsByKeysetId).not.toHaveBeenCalled();
  });
});
