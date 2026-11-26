/**
 * @jest-environment node
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Manager } from '@cashu/coco-core';
import type {
  Keypair,
  KeypairPurpose,
  KeyRingRepository,
  Repositories,
  RepositoryTransactionScope,
} from '@cashu/coco-core/adapter';
import { ExpoSqliteRepositories } from '@cashu/coco-expo-sqlite';
import { createP2PKImportPlugin } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { getPublicKey } from 'nostr-tools/pure';
import { createSovranCocoRepositories } from '@/shared/lib/cashu/cocoRepositories';
import { cashuP2pkPubkeyFromNostrHex } from '@/shared/lib/protocolIds';
import { ExpoSqliteOnNode } from './cocoDatabases/expoSqliteOnNode';

function createScope(overrides: Partial<RepositoryTransactionScope>): RepositoryTransactionScope {
  return {
    mintRepository: {},
    keyRingRepository: {},
    counterRepository: {},
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
  it('passes v2-only repositories through the overlay untouched', async () => {
    const paymentRequestReceiveOperationRepository = { getById: jest.fn() };
    const legacyMintQuoteRepository = { getPendingLegacyMintQuotes: jest.fn(async () => []) };
    const scope = createScope({
      paymentRequestReceiveOperationRepository:
        paymentRequestReceiveOperationRepository as unknown as RepositoryTransactionScope['paymentRequestReceiveOperationRepository'],
      legacyMintQuoteRepository:
        legacyMintQuoteRepository as unknown as RepositoryTransactionScope['legacyMintQuoteRepository'],
    });

    const repositories = createSovranCocoRepositories(createRepositories(scope));

    expect(repositories.paymentRequestReceiveOperationRepository).toBe(
      paymentRequestReceiveOperationRepository
    );
    expect(repositories.legacyMintQuoteRepository).toBe(legacyMintQuoteRepository);
    await repositories.withTransaction(async (transactionScope) => {
      expect(transactionScope.legacyMintQuoteRepository).toBe(legacyMintQuoteRepository);
    });
  });
});

describe('ephemeral keyring overlay', () => {
  const EPHEMERAL_PUBKEY = `02${'ab'.repeat(32)}`;
  const PERSISTED_PUBKEY = `02${'cd'.repeat(32)}`;

  function keypair(
    publicKeyHex: string,
    derivationIndex?: number,
    purpose?: KeypairPurpose
  ): Keypair {
    return { publicKeyHex, secretKey: new Uint8Array(32).fill(7), derivationIndex, purpose };
  }

  function createKeyRingRepository(persisted: Keypair[] = []): KeyRingRepository {
    const rows = new Map(persisted.map((kp) => [kp.publicKeyHex, kp]));
    const byPurpose = (purpose?: KeypairPurpose) =>
      [...rows.values()].filter(
        (kp) => purpose === undefined || (kp.purpose ?? 'p2pk') === purpose
      );
    return {
      getPersistedKeyPair: jest.fn(
        async (publicKey: string, purpose?: KeypairPurpose) =>
          byPurpose(purpose).find((kp) => kp.publicKeyHex === publicKey) ?? null
      ),
      setPersistedKeyPair: jest.fn(async (kp: Keypair) => {
        rows.set(kp.publicKeyHex, kp);
      }),
      deletePersistedKeyPair: jest.fn(async (publicKey: string) => {
        rows.delete(publicKey);
      }),
      getAllPersistedKeyPairs: jest.fn(async (purpose?: KeypairPurpose) => byPurpose(purpose)),
      getLatestKeyPair: jest.fn(
        async (purpose?: KeypairPurpose) => byPurpose(purpose).pop() ?? null
      ),
      getLastAllocatedIndex: jest.fn(async () => null),
      getHighestStoredDerivationIndex: jest.fn(async () => null),
      setLastAllocatedIndex: jest.fn(async () => undefined),
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

    expect(delegate.deletePersistedKeyPair).toHaveBeenCalledWith(EPHEMERAL_PUBKEY, 'p2pk');
    expect(await delegate.getPersistedKeyPair(EPHEMERAL_PUBKEY)).toBeNull();
    // Still resolvable through the overlay — auto-sign keeps working.
    const fetched = await repositories.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY);
    expect(fetched?.publicKeyHex).toBe(EPHEMERAL_PUBKEY);
  });

  it('never answers nut20_mint_quote queries from the overlay', async () => {
    const nut20Key = keypair(PERSISTED_PUBKEY, undefined, 'nut20_mint_quote');
    const delegate = createKeyRingRepository([nut20Key]);
    const repositories = build(delegate);
    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));

    const latest = await repositories.keyRingRepository.getLatestKeyPair('nut20_mint_quote');
    expect(latest?.publicKeyHex).toBe(PERSISTED_PUBKEY);

    const all = await repositories.keyRingRepository.getAllPersistedKeyPairs('nut20_mint_quote');
    expect(all.map((kp) => kp.publicKeyHex)).toEqual([PERSISTED_PUBKEY]);

    const byId = await repositories.keyRingRepository.getPersistedKeyPair(
      EPHEMERAL_PUBKEY,
      'nut20_mint_quote'
    );
    expect(byId).toBeNull();
  });

  it('falls back to the overlay for the latest p2pk keypair only', async () => {
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);
    await repositories.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));

    const latestP2pk = await repositories.keyRingRepository.getLatestKeyPair('p2pk');
    expect(latestP2pk?.publicKeyHex).toBe(EPHEMERAL_PUBKEY);

    const latestNut20 = await repositories.keyRingRepository.getLatestKeyPair('nut20_mint_quote');
    expect(latestNut20).toBeNull();
  });

  it('persists non-ephemeral keypairs through the delegate unchanged', async () => {
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);

    const derived = keypair(PERSISTED_PUBKEY, 3);
    await repositories.keyRingRepository.setPersistedKeyPair(derived);

    expect(delegate.setPersistedKeyPair).toHaveBeenCalledWith(derived);
    expect(await delegate.getPersistedKeyPair(PERSISTED_PUBKEY)).toEqual(derived);
  });

  it('persists an ephemeral-pubkey keypair when its purpose is nut20_mint_quote', async () => {
    // Degenerate case: same pubkey, different purpose — the overlay must not
    // swallow a NUT-20 quote key even if the pubkey collides.
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);

    const nut20 = keypair(EPHEMERAL_PUBKEY, undefined, 'nut20_mint_quote');
    await repositories.keyRingRepository.setPersistedKeyPair(nut20);

    expect(delegate.setPersistedKeyPair).toHaveBeenCalledWith(nut20);
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

  it('delegates keyring queries inside withTransaction to the transaction scope, never the root repo', async () => {
    const rootDelegate = createKeyRingRepository();
    const txDelegate = createKeyRingRepository([keypair(EPHEMERAL_PUBKEY)]);
    const rootScope = createScope({ keyRingRepository: rootDelegate });
    const txScope = createScope({ keyRingRepository: txDelegate });
    const base: Repositories = {
      ...rootScope,
      init: jest.fn(),
      withTransaction: jest.fn(async (fn) => fn(txScope)),
    } as unknown as Repositories;

    const repositories = createSovranCocoRepositories(base, {
      ephemeralKeyringPubkeys: new Set([EPHEMERAL_PUBKEY]),
    });

    await repositories.withTransaction(async (scope) => {
      await scope.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));
      await scope.keyRingRepository.getPersistedKeyPair(PERSISTED_PUBKEY);
    });

    // Root delegate must never be called inside a transaction (ExpoSqliteDb
    // makes root queries wait for the active transaction queue -> deadlock).
    expect(rootDelegate.deletePersistedKeyPair).not.toHaveBeenCalled();
    expect(rootDelegate.getPersistedKeyPair).not.toHaveBeenCalled();
    expect(txDelegate.deletePersistedKeyPair).toHaveBeenCalledWith(EPHEMERAL_PUBKEY, 'p2pk');
    expect(txDelegate.getPersistedKeyPair).toHaveBeenCalledWith(PERSISTED_PUBKEY, undefined);
    // Overlay populated inside the transaction is visible on the root repo.
    const fetched = await repositories.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY);
    expect(fetched?.publicKeyHex).toBe(EPHEMERAL_PUBKEY);
  });

  it('does not publish staged overlay writes if the callback or COMMIT fails', async () => {
    const delegate = createKeyRingRepository();
    const repositories = build(delegate);

    await expect(
      repositories.withTransaction(async (scope) => {
        await scope.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));
        expect(await scope.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY)).not.toBeNull();
        // Uncommitted write must stay invisible to root readers until COMMIT.
        expect(
          await repositories.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY)
        ).toBeNull();
        throw new Error('abort tx');
      })
    ).rejects.toThrow('abort tx');

    expect(await repositories.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY)).toBeNull();

    // Simulate SQLite COMMIT failing after the callback returned cleanly.
    const commitFailScope = createScope({ keyRingRepository: createKeyRingRepository() });
    const commitFailRepo = createSovranCocoRepositories(
      {
        ...commitFailScope,
        init: jest.fn(),
        withTransaction: jest.fn(async (fn) => {
          await fn(commitFailScope);
          throw new Error('SQLITE_BUSY on COMMIT');
        }),
      } as unknown as Repositories,
      { ephemeralKeyringPubkeys: new Set([EPHEMERAL_PUBKEY]) }
    );

    await expect(
      commitFailRepo.withTransaction(async (scope) => {
        await scope.keyRingRepository.setPersistedKeyPair(keypair(EPHEMERAL_PUBKEY));
      })
    ).rejects.toThrow('SQLITE_BUSY on COMMIT');

    expect(await commitFailRepo.keyRingRepository.getPersistedKeyPair(EPHEMERAL_PUBKEY)).toBeNull();
  });

  it('does not deadlock real ExpoSqliteRepositories when Manager.create runs p2pk-import', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coco-keyring-tx-'));
    const db = new ExpoSqliteOnNode(join(dir, 'wallet.db'));
    // 0x2a-filled secret key has an odd-Y canonical compressed pubkey (`03...`),
    // exercising both the transaction-scope fix and canonical/legacy parity handling.
    const secretKey = new Uint8Array(32).fill(0x2a);
    const xOnly = getPublicKey(secretKey);
    const legacyPubkey = cashuP2pkPubkeyFromNostrHex(xOnly);
    const canonicalPubkey = `03${xOnly}`;

    let manager: Manager | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const repositories = createSovranCocoRepositories(
        new ExpoSqliteRepositories({ database: db as never }),
        { ephemeralKeyringPubkeys: new Set([legacyPubkey, canonicalPubkey]) }
      );
      await repositories.init();

      // Seed a legacy always-`02` plaintext row like pre-overlay builds wrote,
      // and verify the odd-Y `03` import scrubs it without deadlocking.
      await db.runAsync(
        `INSERT INTO coco_cashu_keypairs (publicKey, secretKey, createdAt, derivationIndex, purpose)
         VALUES (?, ?, ?, NULL, 'p2pk')`,
        legacyPubkey,
        Buffer.from(secretKey).toString('hex'),
        Date.now()
      );

      const createPromise = Manager.create({
        repo: repositories,
        seedGetter: async () => new Uint8Array(64).fill(1),
        plugins: [createP2PKImportPlugin({ getSecretKeys: () => [new Uint8Array(secretKey)] })],
      });

      const outcome = await Promise.race([
        createPromise.then((m) => ({ status: 'ok' as const, manager: m })),
        new Promise<{ status: 'timeout' }>((resolve) => {
          timeoutHandle = setTimeout(() => resolve({ status: 'timeout' }), 3_000);
        }),
      ]);

      expect(outcome.status).toBe('ok');
      if (outcome.status !== 'ok') return;
      manager = outcome.manager;

      // Ephemeral key is available through Coco's keyring under both canonical
      // (`03`) and legacy (`02`) lookups, and neither parity remains in SQLite.
      const loadedCanonical = await manager.keyring.getKeyPair(canonicalPubkey);
      const loadedLegacy = await manager.keyring.getKeyPair(legacyPubkey);
      expect(loadedCanonical?.publicKeyHex).toBe(canonicalPubkey);
      expect(loadedLegacy?.publicKeyHex).toBe(canonicalPubkey);
      const rows = await db.getAllAsync<{ publicKey: string }>(
        'SELECT publicKey FROM coco_cashu_keypairs WHERE publicKey IN (?, ?)',
        legacyPubkey,
        canonicalPubkey
      );
      expect(rows).toEqual([]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      await manager?.dispose().catch(() => undefined);
      await db.closeAsync().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
