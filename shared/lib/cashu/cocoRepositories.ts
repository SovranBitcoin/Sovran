import type {
  HistoryRepository,
  MeltOperation,
  MeltOperationRepository,
  MeltQuoteRepository,
  MintOperationRepository,
  MintQuoteRepository,
  ProofRepository,
  ReceiveOperationRepository,
  Repositories,
  RepositoryTransactionScope,
  SendOperationRepository,
} from '@cashu/coco-core';

type UnknownRecord = Record<string, unknown>;

const AMOUNT_FIELD = 'amount';

const MELT_OPERATION_NUMBER_FIELDS = [
  'amount',
  'fee_reserve',
  'swap_fee',
  'inputAmount',
  'changeAmount',
  'effectiveFee',
] as const;

function toPersistedCocoNumber(value: unknown, context: string): number {
  let amount: number;

  if (typeof value === 'number') {
    amount = value;
  } else if (typeof value === 'bigint') {
    amount = Number(value);
  } else if (typeof value === 'string') {
    if (value.trim() === '') {
      throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
    }
    amount = Number(value);
  } else if (typeof value === 'object' && value != null && 'toNumber' in value) {
    const maybeNumberLike = value as { toNumber?: unknown };
    if (typeof maybeNumberLike.toNumber !== 'function') {
      throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
    }
    amount = maybeNumberLike.toNumber();
  } else {
    throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
  }

  if (!Number.isFinite(amount) || !Number.isSafeInteger(amount)) {
    throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
  }

  return amount;
}

function normalizeNumberFields<T extends object>(
  value: T,
  fields: readonly string[],
  context: string
): T {
  let changed = false;
  const updates: UnknownRecord = {};
  const record = value as UnknownRecord;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;

    const current = record[field];
    if (current == null || typeof current === 'number') continue;

    updates[field] = toPersistedCocoNumber(current, `${context}.${field}`);
    changed = true;
  }

  if (!changed) return value;

  const normalized: T = { ...value, ...updates };
  return normalized;
}

function normalizeAmount<T extends object>(value: T, context: string): T {
  return normalizeNumberFields(value, [AMOUNT_FIELD], context);
}

function normalizeMaybe<T extends object>(value: T | null, context: string): T | null {
  return value ? normalizeAmount(value, context) : value;
}

function normalizeArray<T extends object>(values: T[], context: string): T[] {
  return values.map((value) => normalizeAmount(value, context));
}

function normalizeMeltOperation(operation: MeltOperation): MeltOperation {
  return normalizeNumberFields(operation, MELT_OPERATION_NUMBER_FIELDS, 'melt operation');
}

function normalizeMeltOperations(operations: MeltOperation[]): MeltOperation[] {
  return operations.map(normalizeMeltOperation);
}

function wrapProofRepository(repository: ProofRepository): ProofRepository {
  return {
    ...repository,
    saveProofs: (...args) => repository.saveProofs(...args),
    getReadyProofs: async (...args) =>
      normalizeArray(await repository.getReadyProofs(...args), 'proof'),
    getInflightProofs: async (...args) =>
      normalizeArray(await repository.getInflightProofs(...args), 'proof'),
    getAllReadyProofs: async () => normalizeArray(await repository.getAllReadyProofs(), 'proof'),
    setProofState: (...args) => repository.setProofState(...args),
    deleteProofs: (...args) => repository.deleteProofs(...args),
    getProofsByKeysetId: async (...args) =>
      normalizeArray(await repository.getProofsByKeysetId(...args), 'proof'),
    wipeProofsByKeysetId: (...args) => repository.wipeProofsByKeysetId(...args),
    reserveProofs: (...args) => repository.reserveProofs(...args),
    releaseProofs: (...args) => repository.releaseProofs(...args),
    setCreatedByOperation: (...args) => repository.setCreatedByOperation(...args),
    getProofBySecret: async (...args) =>
      normalizeMaybe(await repository.getProofBySecret(...args), 'proof'),
    getProofsBySecrets: async (...args) =>
      normalizeArray(await repository.getProofsBySecrets(...args), 'proof'),
    getProofsByOperationId: async (...args) =>
      normalizeArray(await repository.getProofsByOperationId(...args), 'proof'),
    getAvailableProofs: async (...args) =>
      normalizeArray(await repository.getAvailableProofs(...args), 'proof'),
    getReservedProofs: async () => normalizeArray(await repository.getReservedProofs(), 'proof'),
  };
}

function wrapMintQuoteRepository(repository: MintQuoteRepository): MintQuoteRepository {
  return {
    ...repository,
    getMintQuote: async (...args) =>
      normalizeMaybe(await repository.getMintQuote(...args), 'mint quote'),
    addMintQuote: (...args) => repository.addMintQuote(...args),
    setMintQuoteState: (...args) => repository.setMintQuoteState(...args),
    getPendingMintQuotes: async () =>
      normalizeArray(await repository.getPendingMintQuotes(), 'mint quote'),
  };
}

function wrapMeltQuoteRepository(repository: MeltQuoteRepository): MeltQuoteRepository {
  return {
    ...repository,
    getMeltQuote: async (...args) =>
      normalizeMaybe(await repository.getMeltQuote(...args), 'melt quote'),
    addMeltQuote: (...args) => repository.addMeltQuote(...args),
    setMeltQuoteState: (...args) => repository.setMeltQuoteState(...args),
    getPendingMeltQuotes: async () =>
      normalizeArray(await repository.getPendingMeltQuotes(), 'melt quote'),
  };
}

function wrapHistoryRepository(repository: HistoryRepository): HistoryRepository {
  return {
    ...repository,
    getPaginatedHistoryEntries: async (...args) =>
      normalizeArray(await repository.getPaginatedHistoryEntries(...args), 'history entry'),
    getHistoryEntryById: async (...args) =>
      normalizeMaybe(await repository.getHistoryEntryById(...args), 'history entry'),
    addHistoryEntry: async (...args) =>
      normalizeAmount(await repository.addHistoryEntry(...args), 'history entry'),
    getMintHistoryEntry: async (...args) =>
      normalizeMaybe(await repository.getMintHistoryEntry(...args), 'history entry'),
    getMeltHistoryEntry: async (...args) =>
      normalizeMaybe(await repository.getMeltHistoryEntry(...args), 'history entry'),
    getSendHistoryEntry: async (...args) =>
      normalizeMaybe(await repository.getSendHistoryEntry(...args), 'history entry'),
    getReceiveHistoryEntry: async (...args) =>
      normalizeMaybe(await repository.getReceiveHistoryEntry(...args), 'history entry'),
    updateHistoryEntry: async (...args) =>
      normalizeAmount(await repository.updateHistoryEntry(...args), 'history entry'),
    updateSendHistoryState: (...args) => repository.updateSendHistoryState(...args),
    updateReceiveHistoryState: (...args) => repository.updateReceiveHistoryState(...args),
    deleteHistoryEntry: (...args) => repository.deleteHistoryEntry(...args),
  };
}

function wrapSendOperationRepository(repository: SendOperationRepository): SendOperationRepository {
  return {
    ...repository,
    create: (...args) => repository.create(...args),
    update: (...args) => repository.update(...args),
    getById: async (...args) => normalizeMaybe(await repository.getById(...args), 'send operation'),
    getByState: async (...args) =>
      normalizeArray(await repository.getByState(...args), 'send operation'),
    getPending: async () => normalizeArray(await repository.getPending(), 'send operation'),
    getByMintUrl: async (...args) =>
      normalizeArray(await repository.getByMintUrl(...args), 'send operation'),
    delete: (...args) => repository.delete(...args),
  };
}

function wrapMeltOperationRepository(repository: MeltOperationRepository): MeltOperationRepository {
  return {
    ...repository,
    create: (...args) => repository.create(...args),
    update: (...args) => repository.update(...args),
    getById: async (...args) => {
      const operation = await repository.getById(...args);
      return operation ? normalizeMeltOperation(operation) : operation;
    },
    getByState: async (...args) => normalizeMeltOperations(await repository.getByState(...args)),
    getPending: async () => normalizeMeltOperations(await repository.getPending()),
    getByMintUrl: async (...args) =>
      normalizeMeltOperations(await repository.getByMintUrl(...args)),
    getByQuoteId: async (...args) =>
      normalizeMeltOperations(await repository.getByQuoteId(...args)),
    delete: (...args) => repository.delete(...args),
  };
}

function wrapMintOperationRepository(repository: MintOperationRepository): MintOperationRepository {
  return {
    ...repository,
    create: (...args) => repository.create(...args),
    update: (...args) => repository.update(...args),
    getById: async (...args) => normalizeMaybe(await repository.getById(...args), 'mint operation'),
    getByState: async (...args) =>
      normalizeArray(await repository.getByState(...args), 'mint operation'),
    getPending: async () => normalizeArray(await repository.getPending(), 'mint operation'),
    getByMintUrl: async (...args) =>
      normalizeArray(await repository.getByMintUrl(...args), 'mint operation'),
    getByQuoteId: async (...args) =>
      normalizeArray(await repository.getByQuoteId(...args), 'mint operation'),
    delete: (...args) => repository.delete(...args),
  };
}

function wrapReceiveOperationRepository(
  repository: ReceiveOperationRepository
): ReceiveOperationRepository {
  return {
    ...repository,
    create: (...args) => repository.create(...args),
    update: (...args) => repository.update(...args),
    getById: async (...args) =>
      normalizeMaybe(await repository.getById(...args), 'receive operation'),
    getByState: async (...args) =>
      normalizeArray(await repository.getByState(...args), 'receive operation'),
    getPending: async () => normalizeArray(await repository.getPending(), 'receive operation'),
    getByMintUrl: async (...args) =>
      normalizeArray(await repository.getByMintUrl(...args), 'receive operation'),
    delete: (...args) => repository.delete(...args),
  };
}

function normalizeRepositoryScope(scope: RepositoryTransactionScope): RepositoryTransactionScope {
  return {
    ...scope,
    proofRepository: wrapProofRepository(scope.proofRepository),
    mintQuoteRepository: wrapMintQuoteRepository(scope.mintQuoteRepository),
    meltQuoteRepository: wrapMeltQuoteRepository(scope.meltQuoteRepository),
    historyRepository: wrapHistoryRepository(scope.historyRepository),
    sendOperationRepository: wrapSendOperationRepository(scope.sendOperationRepository),
    meltOperationRepository: wrapMeltOperationRepository(scope.meltOperationRepository),
    mintOperationRepository: wrapMintOperationRepository(scope.mintOperationRepository),
    receiveOperationRepository: wrapReceiveOperationRepository(scope.receiveOperationRepository),
  };
}

export function createSovranCocoRepositories(repositories: Repositories): Repositories {
  return {
    ...normalizeRepositoryScope(repositories),
    init: () => repositories.init(),
    withTransaction: (fn) =>
      repositories.withTransaction((scope) => fn(normalizeRepositoryScope(scope))),
  };
}
