/**
 * @jest-environment node
 */

import type {
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
