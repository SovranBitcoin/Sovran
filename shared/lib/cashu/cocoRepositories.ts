import type {
  HistoryRepository,
  Keypair,
  KeyRingRepository,
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
import { cashuLog } from '@/shared/lib/logger';

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

function persistedValueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function logInvalidPersistedNumber(context: string, value: unknown): void {
  cashuLog.warn('cashu.repository.number_field_invalid', {
    context,
    valueKind: persistedValueKind(value),
  });
}

function toPersistedCocoNumber(value: unknown, context: string): number {
  let amount: number;

  if (typeof value === 'number') {
    amount = value;
  } else if (typeof value === 'bigint') {
    amount = Number(value);
  } else if (typeof value === 'string') {
    if (value.trim() === '') {
      logInvalidPersistedNumber(context, value);
      throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
    }
    amount = Number(value);
  } else if (typeof value === 'object' && value != null && 'toNumber' in value) {
    const maybeNumberLike = value as { toNumber?: unknown };
    if (typeof maybeNumberLike.toNumber !== 'function') {
      logInvalidPersistedNumber(context, value);
      throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
    }
    amount = maybeNumberLike.toNumber();
  } else {
    logInvalidPersistedNumber(context, value);
    throw new Error(`Invalid persisted Coco ${context}: ${String(value)}`);
  }

  if (!Number.isFinite(amount) || !Number.isSafeInteger(amount)) {
    logInvalidPersistedNumber(context, value);
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
  const normalizedFields: string[] = [];
  const record = value as UnknownRecord;

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;

    const current = record[field];
    if (current == null || typeof current === 'number') continue;

    updates[field] = toPersistedCocoNumber(current, `${context}.${field}`);
    normalizedFields.push(field);
    changed = true;
  }

  if (!changed) return value;

  const normalized: T = { ...value, ...updates };
  cashuLog.debug('cashu.repository.number_fields_normalized', {
    context,
    fields: normalizedFields,
    fieldCount: normalizedFields.length,
  });
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

/**
 * In-memory overlay for "ephemeral" keyring keys — keys that must NEVER be
 * written to SQLite (the active profile's Nostr signer key, imported by the
 * p2pk-import plugin so coco can auto-sign P2PK receives). Coco's SQLite
 * KeyRingRepository stores secret keys as PLAINTEXT hex; the Sovran invariant
 * is that profile private keys live in SecureStore only.
 *
 * The plugin re-imports its keys on every manager init, so an in-process Map
 * (scoped to this repositories instance — one per manager, one manager per
 * profile session) repopulates each session and can never bleed across a
 * profile switch. Self-healing: when an ephemeral key is (re-)imported, any
 * legacy plaintext row from earlier builds is deleted from SQLite.
 *
 * Everything else — coco-derived keys (with derivationIndex), NUT-20 quote
 * keys, user-imported keys from the Settings keyring screen, the bundled
 * giveaway key (a build-time constant, extractable from the binary anyway) —
 * keeps persisting through the delegate unchanged.
 */
function wrapKeyRingRepository(
  repository: KeyRingRepository,
  ephemeralPubkeys: ReadonlySet<string>,
  overlay: Map<string, Keypair>
): KeyRingRepository {
  return {
    getPersistedKeyPair: async (publicKey) => {
      const overlayKeyPair = overlay.get(publicKey);
      if (overlayKeyPair) {
        cashuLog.debug('cashu.repository.keyring.overlay_hit', {
          overlaySize: overlay.size,
        });
        return overlayKeyPair;
      }
      return repository.getPersistedKeyPair(publicKey);
    },
    setPersistedKeyPair: async (keyPair) => {
      if (ephemeralPubkeys.has(keyPair.publicKeyHex)) {
        overlay.set(keyPair.publicKeyHex, keyPair);
        cashuLog.info('cashu.repository.keyring.ephemeral_set', {
          overlaySize: overlay.size,
          ephemeralCount: ephemeralPubkeys.size,
        });
        // Scrub any legacy plaintext row written by builds that predate the
        // overlay. Exact primary-key match — cannot touch other keys.
        await repository.deletePersistedKeyPair(keyPair.publicKeyHex);
        cashuLog.info('cashu.repository.keyring.ephemeral_scrubbed', {
          overlaySize: overlay.size,
        });
        return;
      }
      return repository.setPersistedKeyPair(keyPair);
    },
    deletePersistedKeyPair: async (publicKey) => {
      const removedOverlay = overlay.delete(publicKey);
      if (removedOverlay) {
        cashuLog.debug('cashu.repository.keyring.overlay_deleted', {
          overlaySize: overlay.size,
        });
      }
      return repository.deletePersistedKeyPair(publicKey);
    },
    getAllPersistedKeyPairs: async () => {
      const persisted = await repository.getAllPersistedKeyPairs();
      const filtered = persisted.filter((keyPair) => !overlay.has(keyPair.publicKeyHex));
      cashuLog.debug('cashu.repository.keyring.all_loaded', {
        persistedCount: persisted.length,
        overlayCount: overlay.size,
        returnedCount: filtered.length + overlay.size,
      });
      return [...filtered, ...overlay.values()];
    },
    getLatestKeyPair: async () => {
      const latest = await repository.getLatestKeyPair();
      if (latest) {
        cashuLog.debug('cashu.repository.keyring.latest_loaded', { source: 'persisted' });
        return latest;
      }
      const first = overlay.values().next();
      cashuLog.debug('cashu.repository.keyring.latest_loaded', {
        source: first.done ? 'none' : 'overlay',
        overlaySize: overlay.size,
      });
      return first.done ? null : first.value;
    },
    getLastDerivationIndex: () => repository.getLastDerivationIndex(),
  };
}

interface SovranCocoRepositoriesOptions {
  /**
   * `02`-prefixed compressed pubkeys whose keypairs must stay in memory
   * instead of coco's plaintext SQLite keyring (the active profile's signer
   * key). Empty set → keyring passes through untouched.
   */
  ephemeralKeyringPubkeys?: ReadonlySet<string>;
}

function normalizeRepositoryScope(
  scope: RepositoryTransactionScope,
  keyRing: KeyRingRepository | null
): RepositoryTransactionScope {
  return {
    ...scope,
    ...(keyRing ? { keyRingRepository: keyRing } : {}),
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

export function createSovranCocoRepositories(
  repositories: Repositories,
  options: SovranCocoRepositoriesOptions = {}
): Repositories {
  const ephemeralPubkeys = options.ephemeralKeyringPubkeys ?? new Set<string>();
  cashuLog.info('cashu.repository.wrapper.created', {
    hasEphemeralKeyring: ephemeralPubkeys.size > 0,
    ephemeralCount: ephemeralPubkeys.size,
  });
  // One overlay per repositories instance (one manager per profile session);
  // the SAME wrapped keyring is shared by the top-level repo and every
  // transaction scope so reads inside transactions see overlay keys.
  const overlay = new Map<string, Keypair>();
  const keyRing =
    ephemeralPubkeys.size > 0
      ? wrapKeyRingRepository(repositories.keyRingRepository, ephemeralPubkeys, overlay)
      : null;

  return {
    ...normalizeRepositoryScope(repositories, keyRing),
    init: () => repositories.init(),
    withTransaction: async (fn) => {
      const startedAt = Date.now();
      cashuLog.debug('cashu.repository.transaction.start', {
        hasEphemeralKeyring: ephemeralPubkeys.size > 0,
      });
      try {
        const result = await repositories.withTransaction((scope) =>
          fn(normalizeRepositoryScope(scope, keyRing))
        );
        cashuLog.debug('cashu.repository.transaction.done', {
          duration_ms: Date.now() - startedAt,
        });
        return result;
      } catch (error) {
        cashuLog.warn('cashu.repository.transaction.failed', {
          duration_ms: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}
