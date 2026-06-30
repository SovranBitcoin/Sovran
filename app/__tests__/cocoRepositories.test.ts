/**
 * @jest-environment node
 */

import type {
  Keypair,
  KeyRingRepository,
  MintOperation,
  MintOperationRepository,
  Repositories,
  RepositoryTransactionScope,
} from '@cashu/coco-core';
import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';

function mintOperation(amount: unknown): MintOperation {
  return {
    id: 'mint-op',
    mintUrl: 'https://mint.example',
    createdAt: 1,
    updatedAt: 1,
    state: 'init',
    method: 'bolt11',
    methodData: {},
    amount,
    unit: 'sat',
  } as unknown as MintOperation;
}

function createMintOperationRepository(amount: unknown): MintOperationRepository {
  return {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    getById: jest.fn(async () => mintOperation(amount)),
    getByState: jest.fn(async () => [mintOperation(amount)]),
    getPending: jest.fn(async () => [mintOperation(amount)]),
    getByMintUrl: jest.fn(async () => [mintOperation(amount)]),
    getByQuoteId: jest.fn(async () => [mintOperation(amount)]),
  };
}

function createScope(overrides: Partial<RepositoryTransactionScope>): RepositoryTransactionScope {
  return {
    mintRepository: {},
    keyRingRepository: {},
    counterRepository: {},
    keysetRepository: {},
    proofRepository: {},
    mintQuoteRepository: {},
    meltQuoteRepository: {},
    historyRepository: {},
    sendOperationRepository: {},
    meltOperationRepository: {},
    authSessionRepository: {},
    mintOperationRepository: {},
    receiveOperationRepository: {},
    ...overrides,
  } as unknown as RepositoryTransactionScope;
}

function createRepositories(scope: RepositoryTransactionScope): Repositories {
  return {
    ...scope,
    init: jest.fn(),
    withTransaction: jest.fn(async (fn) => fn(scope)),
  } as unknown as Repositories;
}

describe('createSovranCocoRepositories', () => {
  it('normalizes persisted mint operation amounts to numbers', async () => {
    const scope = createScope({
      mintOperationRepository: createMintOperationRepository('10000'),
    });

    const repositories = createSovranCocoRepositories(createRepositories(scope));

    const byId = await repositories.mintOperationRepository.getById('mint-op');
    const byState = await repositories.mintOperationRepository.getByState('init');

    expect(byId?.amount).toBe(10000);
    expect(typeof byId?.amount).toBe('number');
    expect(byState[0]?.amount).toBe(10000);
    expect(typeof byState[0]?.amount).toBe('number');
  });

  it('normalizes transaction-scoped repository reads', async () => {
    const scope = createScope({
      mintOperationRepository: createMintOperationRepository('10000'),
    });

    const repositories = createSovranCocoRepositories(createRepositories(scope));

    await repositories.withTransaction(async (transactionScope) => {
      const operation = await transactionScope.mintOperationRepository.getById('mint-op');

      expect(operation?.amount).toBe(10000);
      expect(typeof operation?.amount).toBe('number');
    });
  });

  it('rejects corrupt persisted amount values at the app boundary', async () => {
    const scope = createScope({
      mintOperationRepository: createMintOperationRepository('not-a-number'),
    });

    const repositories = createSovranCocoRepositories(createRepositories(scope));

    await expect(repositories.mintOperationRepository.getById('mint-op')).rejects.toThrow(
      'Invalid persisted Coco mint operation.amount'
    );
  });
});

describe('ephemeral keyring overlay', () => {
  const EPHEMERAL_PUBKEY = `02${'ab'.repeat(32)}`;
  const PERSISTED_PUBKEY = `02${'cd'.repeat(32)}`;

  function keypair(publicKeyHex: string, derivationIndex?: number): Keypair {
    return { publicKeyHex, secretKey: new Uint8Array(32).fill(7), derivationIndex };
  }

  function createKeyRingRepository(persisted: Keypair[] = []): KeyRingRepository {
    const rows = new Map(persisted.map((kp) => [kp.publicKeyHex, kp]));
    return {
      getPersistedKeyPair: jest.fn(async (publicKey: string) => rows.get(publicKey) ?? null),
      setPersistedKeyPair: jest.fn(async (kp: Keypair) => {
        rows.set(kp.publicKeyHex, kp);
      }),
      deletePersistedKeyPair: jest.fn(async (publicKey: string) => {
        rows.delete(publicKey);
      }),
      getAllPersistedKeyPairs: jest.fn(async () => [...rows.values()]),
      getLatestKeyPair: jest.fn(async () => [...rows.values()].pop() ?? null),
      getLastDerivationIndex: jest.fn(async () => 0),
    };
  }

  function build(keyRing: KeyRingRepository) {
    const scope = createScope({ keyRingRepository: keyRing });
    return createSovranCocoRepositories(createRepositories(scope), {
      ephemeralKeyringPubkeys: new Set([EPHEMERAL_PUBKEY]),
    });
  }

  it('keeps ephemeral keypairs in memory and out of the delegate', async () => {
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);

    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));

    expect(delegate.setPersistedKeyPair).not.toHaveBeenCalled();
    const fetched = await repositories.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY);
    expect(fetched?.publicKeyHex).toBe(EPHEMERAL_PUBKEY);
    expect(await delegate.getPersistedKeyPair(EPHEMERAL_PUBKEY)).toBeNull();
  });

  it('scrubs a legacy plaintext row when the ephemeral key is re-imported', async () => {
    const delegate = createKeyRingRepository([keypair(EPHEMERAL_PUBKEY)]);
    const repositories = build(delegate);

    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));

    expect(delegate.deletePersistedKeyPair).toHaveBeenCalledWith(EPHEMERAL_PUBKEY);
    expect(await delegate.getPersistedKeyPair(EPHEMERAL_PUBKEY)).toBeNull();
    // Still resolvable through the overlay — auto-sign keeps working.
    const fetched = await repositories.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY);
    expect(fetched?.publicKeyHex).toBe(EPHEMERAL_PUBKEY);
  });

  it('persists non-ephemeral keypairs through the delegate unchanged', async () => {
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);

    const derived = keypair(PERSISTED_PUBKEY, 3);
    await repositories.keyRingRepository.setPersistedKeyPair(derived);

    expect(delegate.setPersistedKeyPair).toHaveBeenCalledWith(derived);
    expect(await delegate.getPersistedKeyPair(PERSISTED_PUBKEY)).toEqual(derived);
  });

  it('merges overlay keys into getAllPersistedKeyPairs without duplicates', async () => {
    const delegate = createKeyRingRepository([keypair(PERSISTED_PUBKEY, 1)]);
    const repositories = build(delegate);
    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));

    const all = await repositories.keyRingRepository.getAllPersistedKeyPairs();
    expect(all.map((kp) => kp.publicKeyHex).sort()).toEqual(
      [EPHEMERAL_PUBKEY, PERSISTED_PUBKEY].sort()
    );
  });

  it('shares the overlay with transaction scopes', async () => {
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);
    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));

    await repositories.withTransaction(async (transactionScope) => {
      const fetched =
        await transactionScope.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY);
      expect(fetched?.publicKeyHex).toBe(EPHEMERAL_PUBKEY);
    });
  });

  it('leaves the keyring untouched when no ephemeral pubkeys are configured', async () => {
    const delegate = createKeyRingRepository();
    const scope = createScope({ keyRingRepository: delegate });
    const repositories = createSovranCocoRepositories(createRepositories(scope));

    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));
    expect(delegate.setPersistedKeyPair).toHaveBeenCalled();
  });
});
