import { Manager } from '@cashu/coco-core';
import type { Plugin } from '@cashu/coco-core/plugin';
import { createCashuSeedGetter, deriveStandardCashuSeed } from 'wallet';
import { CocoCoreLogger } from './cocoLogger';
import {
  ExpoSqliteRepositories,
  type ExpoSqliteRepositoriesOptions,
} from '@cashu/coco-expo-sqlite';
import { createSovranCocoRepositories } from './cocoRepositories';
import * as SQLite from 'expo-sqlite';
import {
  retrieveMnemonic,
  retrieveCashuSeed,
  storeCashuSeed,
  hashMnemonic,
} from '@/shared/lib/nostr/secureStorage';
import { NPCPlugin, type NPCAccountApi, type Signer as NpcSigner } from 'coco-cashu-plugin-npc';
import { createPaymentRequestNostrTransportPlugin } from '@/shared/lib/cashu/paymentRequestNostrTransport';
import {
  NPC_BASE_URL,
  NPC_SYNC_INTERVAL_MS,
  AsyncStorageSinceStore,
  createNpcClient,
  getNpcSinceStoreKey,
} from './npc';
import {
  deriveNostrKeys,
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
} from '@/shared/lib/nostr/keyDerivation';
import { getInflightProofs, restoreProofsToReady } from './managerInternals';
import { reconcileE2EReadyProofs } from './e2eReadyProofReconciliation';
import { maybeCreateMintFaultWebSocketFactory } from '@/shared/lib/e2e/mintFaults/webSocketFactory';
import * as FileSystem from 'expo-file-system/legacy';
import { EventTemplate, finalizeEvent, getPublicKey, VerifiedEvent } from 'nostr-tools';
import * as Sharing from 'expo-sharing';
import { cashuLog, initLog, initPhase, redactError } from '../logger';
import { resolveOutputDataCreator } from './nativeOutputDataCreator';
import { logCocoVersions, reportCocoApiFailure, reportCocoIssue } from './cocoFeedback';
import {
  createP2PKImportPlugin,
  type P2PKSecretKeyInput,
} from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import Constants from 'expo-constants';

// Shared giveaway P2PK key, injected at build time via app.config.js `extra`
// (from the non-EXPO_PUBLIC `GIVEAWAY_P2PK_SECRET`). This is intentionally
// GLOBAL across every profile and install — it is NOT a stored profile nsec —
// so any install can redeem giveaway ecash P2PK-locked to its public key. The
// plugin accepts an nsec or 64-hex string and decodes it. SECURITY: a bundled
// key is extractable; only lock low-value, rotatable giveaways to it. See
// ../.agents/skills/sovran-security/references/secure-storage-key-derivation.md.
const GIVEAWAY_P2PK_SECRET: string | null =
  typeof Constants.expoConfig?.extra?.giveawayP2pkSecret === 'string' &&
  Constants.expoConfig.extra.giveawayP2pkSecret.length > 0
    ? Constants.expoConfig.extra.giveawayP2pkSecret
    : null;

function mintUrlLogFields(mintUrl: string | null | undefined): Record<string, unknown> {
  return {
    hasMintUrl: !!mintUrl,
    mintUrlLength: mintUrl?.length ?? 0,
  };
}

interface Signer {
  signEvent: (e: EventTemplate) => Promise<VerifiedEvent>;
}

/** Holds an unencrypted secp256k1 secret key in JS heap. Never exported —
 *  callers compose against the Manager's `signEvent` boundary, not the raw
 *  signer instance. The class lives here, beside its only callers. */
class NsecSigner implements Signer {
  private readonly secretKey: Uint8Array;

  constructor(secretKey: Uint8Array) {
    if (secretKey.length !== 32) {
      throw new Error('Expected secret key of 32 bytes');
    }
    this.secretKey = secretKey;
  }
  async signEvent(e: EventTemplate) {
    return finalizeEvent(e, this.secretKey);
  }
}

/**
 * Coco Manager singleton for managing Cashu operations
 */
export class CocoManager {
  private static instance: Manager | null = null;
  private static db: SQLite.SQLiteDatabase | null = null;
  /** Tracks an in-flight initialize() call so concurrent callers can await it
   *  rather than polling a boolean. Cleared in the initializer's finally. */
  private static pendingInit: Promise<Manager> | null = null;
  /** True while enableSafeWatchers / recovery / default mint init are running. */
  private static isBackgroundRunning = false;
  /** Tracks an in-flight cleanup() call so initialize() can await it before proceeding. */
  private static pendingCleanup: Promise<void> | null = null;
  private static cashuMnemonic: string | null = null;
  private static signerKey: Uint8Array | null = null;
  private static npcPlugin: NPCPlugin | null = null;
  private static npcAccount: NPCAccountApi | null = null;
  private static npcPluginRegistered = false;
  /** Stored reference to seed getter for pre-warming during background init */
  private static seedGetter: (() => Promise<Uint8Array>) | null = null;
  /** Current account index — controls which DB file and NPC signer to use */
  private static accountIndex = 0;
  /** True when the active profile is an imported nsec (affects signer/seed fallback paths) */
  private static isImportedProfile = false;

  /** Clear sensitive in-memory state that should not survive profile switches. */
  private static clearSensitiveRuntimeState(): void {
    this.signerKey = null;
    this.cashuMnemonic = null;
    this.npcPlugin = null;
    this.npcAccount = null;
    this.npcPluginRegistered = false;
    this.seedGetter = null;
    this.isImportedProfile = false;
  }

  /**
   * Set the account index for per-profile database isolation.
   * Must be called before initialize().
   * Account 0 uses 'coco.db' (backward compatible), N>0 uses 'coco-N.db'.
   */
  static setAccountIndex(index: number, imported = false): void {
    this.accountIndex = index;
    this.isImportedProfile = imported;
    cashuLog.info('cashu.manager.account_index_set', {
      accountIndex: index,
      imported,
      dbName: this.getDbName(),
    });
  }

  /** Get the SQLite database name for the current account index */
  private static getDbName(): string {
    return this.accountIndex === 0 ? 'coco.db' : `coco-${this.accountIndex}.db`;
  }

  /** File-system paths for a coco database and its pre-v2 backup set. */
  private static getDbPaths(dbName: string) {
    const dbPath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
    return {
      dbPath,
      sidecars: [`${dbPath}-wal`, `${dbPath}-shm`] as const,
      backupPath: `${dbPath}.pre-v2`,
      backupSidecars: [`${dbPath}.pre-v2-wal`, `${dbPath}.pre-v2-shm`] as const,
    };
  }

  /** Table names + applied-migration count for an open coco database. */
  private static async dumpSchemaState(
    db: SQLite.SQLiteDatabase
  ): Promise<{ tables: string[]; migrationCount: number }> {
    const rows = await db.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tables = rows.map((row) => row.name);
    let migrationCount = 0;
    if (tables.includes('coco_cashu_migrations')) {
      const row = await db.getFirstAsync<{ c: number }>(
        'SELECT COUNT(*) AS c FROM coco_cashu_migrations'
      );
      migrationCount = row?.c ?? 0;
    }
    return { tables, migrationCount };
  }

  /** Per-unit ready-proof sums, e.g. "sat=1234(12)" — amounts only, no proof data. */
  private static async snapshotReadyProofBalances(
    db: SQLite.SQLiteDatabase,
    tables: string[]
  ): Promise<string | null> {
    if (!tables.includes('coco_cashu_proofs')) return null;
    const rows = await db.getAllAsync<{ unit: string | null; total: number | null; cnt: number }>(
      "SELECT unit, SUM(CAST(amount AS INTEGER)) AS total, COUNT(*) AS cnt FROM coco_cashu_proofs WHERE state = 'ready' GROUP BY unit"
    );
    if (rows.length === 0) return 'empty';
    return rows.map((row) => `${row.unit ?? 'sat'}=${row.total ?? 0}(${row.cnt})`).join(',');
  }

  /**
   * v1→v2 migration safety rails, run after opening the DB but BEFORE
   * `repositories.init()` applies coco's forward-only schema migrations
   * (024–036 rewrite money columns to TEXT and restructure melt quotes; a
   * migrated DB cannot be read by a v1 build). When the database still has
   * the v1 schema, take a one-time file copy (`<dbName>.pre-v2`) so the
   * wallet can be manually restored, and log schema + ready-proof snapshots
   * so the migration outcome is verifiable from log.txt.
   *
   * Never throws — a failed backup logs and lets init proceed. Returns the
   * live DB handle (reopened when the backup had to close it) and the
   * pre-init migration count (-1 when unknown).
   */
  private static async runPreInitSafetyRails(
    db: SQLite.SQLiteDatabase,
    dbName: string
  ): Promise<{ db: SQLite.SQLiteDatabase; migrationCount: number; migrationExpected: boolean }> {
    try {
      const { tables, migrationCount } = await this.dumpSchemaState(db);
      const isPreV2 = tables.length > 0 && !tables.includes('coco_cashu_canonical_mint_quotes');
      // A migration will run this boot when the DB is still v1 OR brand new
      // (fresh installs apply the full chain) — that gates the post-init dump.
      const migrationExpected = isPreV2 || tables.length === 0;
      cashuLog.info('cashu.manager.schema_dump.before', {
        dbName,
        tableCount: tables.length,
        migrationCount,
        isPreV2,
      });
      if (!isPreV2) {
        return { db, migrationCount, migrationExpected };
      }

      const balances = await this.snapshotReadyProofBalances(db, tables).catch(() => null);
      cashuLog.info('cashu.manager.balance_snapshot.pre_migration', { dbName, balances });
      await this.scanNonCanonicalAmounts(db, dbName, tables).catch(() => undefined);

      const { dbPath, sidecars, backupPath, backupSidecars } = this.getDbPaths(dbName);
      const existing = await FileSystem.getInfoAsync(backupPath);
      if (existing.exists) {
        cashuLog.info('cashu.manager.db_backup.skipped', { dbName, reason: 'backup_exists' });
        return { db, migrationCount, migrationExpected: true };
      }

      cashuLog.info('cashu.manager.db_backup.start', { dbName });
      // Close first so the WAL checkpoint lands in the main file, then copy
      // the full file set and reopen for the migration run.
      await db.closeAsync();
      await FileSystem.copyAsync({ from: dbPath, to: backupPath });
      for (let i = 0; i < sidecars.length; i++) {
        const info = await FileSystem.getInfoAsync(sidecars[i]);
        if (info.exists) {
          await FileSystem.copyAsync({ from: sidecars[i], to: backupSidecars[i] });
        }
      }
      const backupInfo = await FileSystem.getInfoAsync(backupPath);
      const reopened = await SQLite.openDatabaseAsync(dbName);
      cashuLog.info('cashu.manager.db_backup.done', {
        dbName,
        bytes: backupInfo.exists && 'size' in backupInfo ? backupInfo.size : 0,
      });
      return { db: reopened, migrationCount, migrationExpected: true };
    } catch (error) {
      cashuLog.error('cashu.manager.db_backup.failed', { dbName, error });
      // The handle may have been closed mid-backup; make sure init still gets a live one.
      try {
        await db.getFirstAsync('SELECT 1');
        return { db, migrationCount: -1, migrationExpected: true };
      } catch {
        return {
          db: await SQLite.openDatabaseAsync(dbName),
          migrationCount: -1,
          migrationExpected: true,
        };
      }
    }
  }

  /**
   * Read-only scan for v1 money values the deleted number-healer used to
   * coerce (floats, whitespace strings, unsafe integers). coco v2's
   * Amount.from THROWS on these after migration, so surfacing counts here
   * lets a rehearsal boot catch them before real users hit zeroed balances.
   */
  private static async scanNonCanonicalAmounts(
    db: SQLite.SQLiteDatabase,
    dbName: string,
    tables: string[]
  ): Promise<void> {
    for (const table of ['coco_cashu_proofs', 'coco_cashu_history']) {
      if (!tables.includes(table)) continue;
      const row = await db.getFirstAsync<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${table} WHERE amount IS NOT NULL AND typeof(amount) != 'integer'`
      );
      if ((row?.c ?? 0) > 0) {
        cashuLog.warn('cashu.manager.noncanonical_amounts', {
          dbName,
          table,
          count: row?.c ?? 0,
        });
      }
    }
  }

  /** Post-`repositories.init()` schema dump; pairs with schema_dump.before. */
  private static async logPostInitSchema(
    db: SQLite.SQLiteDatabase,
    dbName: string,
    beforeMigrationCount: number
  ): Promise<void> {
    try {
      const { tables, migrationCount } = await this.dumpSchemaState(db);
      cashuLog.info('cashu.manager.schema_dump.after', {
        dbName,
        tableCount: tables.length,
        migrationCount,
        tables: tables.join(','),
      });
      if (beforeMigrationCount >= 0 && migrationCount === beforeMigrationCount) {
        // A migration boot that applied nothing: either ensureSchema didn't
        // run inside repositories.init() or the migration chain no-opped —
        // both worth reporting upstream with counts.
        reportCocoIssue('migration_not_advanced', {
          dbName,
          fromCount: beforeMigrationCount,
          toCount: migrationCount,
        });
      }
      if (beforeMigrationCount >= 0 && migrationCount > beforeMigrationCount) {
        const balances = await this.snapshotReadyProofBalances(db, tables).catch(() => null);
        cashuLog.info('cashu.manager.migration.applied', {
          dbName,
          fromCount: beforeMigrationCount,
          toCount: migrationCount,
          balances,
        });
      }
    } catch (error) {
      cashuLog.warn('cashu.manager.schema_dump.after_failed', { dbName, error });
    }
  }

  /**
   * Set the cashu mnemonic from NostrKeysProvider
   * This should be called before initialize()
   */
  static setCashuMnemonic(mnemonic: string): void {
    this.cashuMnemonic = mnemonic;
    cashuLog.debug('cashu.manager.cashu_mnemonic_set', {
      hasMnemonic: mnemonic.length > 0,
    });
  }

  /**
   * Set the Nostr private key so getCurrentProfileSigner() can skip derivation.
   * Called from CocoProvider with the key already derived by NostrKeysProvider.
   */
  static setSignerKey(sk: Uint8Array): void {
    this.signerKey = new Uint8Array(sk);
    cashuLog.debug('cashu.manager.signer_key_set', {
      byteLength: sk.length,
    });
  }

  /**
   * Initialize the Coco Manager with database and seed management.
   * This creates the Manager instance only — no network calls, no watchers.
   * Call {@link enableSafeWatchers} and {@link enableNpcSyncAndProcessor}
   * separately (in a non-blocking phase) — NPC sync must stay gated on the
   * NUT-13 restore so deterministic counters don't desync from the mint.
   */
  static async initialize(): Promise<Manager> {
    // If a cleanup() call is still running (e.g. fire-and-forget from CocoProvider
    // unmount during hot reload), wait for it to finish before we decide whether
    // to return the existing instance or start a fresh one.
    if (this.pendingCleanup) {
      initLog('CocoManager', 'cleanup in progress, waiting before initialize...');
      cashuLog.info('cashu.manager.initialize.wait_cleanup', {
        accountIndex: this.accountIndex,
        dbName: this.getDbName(),
      });
      await this.pendingCleanup;
    }

    if (this.instance) {
      initLog('CocoManager', 'already initialized, returning existing instance');
      cashuLog.debug('cashu.manager.initialize.reuse', {
        accountIndex: this.accountIndex,
        dbName: this.getDbName(),
      });
      return this.instance;
    }

    if (this.pendingInit) {
      initLog('CocoManager', 'initialization in progress, awaiting in-flight promise');
      cashuLog.info('cashu.manager.initialize.join_pending', {
        accountIndex: this.accountIndex,
        dbName: this.getDbName(),
      });
      return this.pendingInit;
    }

    this.instance = null;
    const initStart = performance.now();
    const doInitialize = async (): Promise<Manager> => {
      try {
        const p2pkImportSecretKey = this.signerKey ? new Uint8Array(this.signerKey) : null;

        // 1. SQLite database (async to avoid blocking JS thread during profile switch)
        const dbName = this.getDbName();
        cashuLog.info('cashu.manager.initialize.start', {
          accountIndex: this.accountIndex,
          dbName,
          importedProfile: this.isImportedProfile,
          hasCashuMnemonic: !!this.cashuMnemonic,
          hasSignerKey: !!p2pkImportSecretKey,
          hasGiveawayP2PK: !!GIVEAWAY_P2PK_SECRET,
        });
        logCocoVersions();
        const opened = await initPhase(`CocoManager.openDB[${dbName}]`, () =>
          SQLite.openDatabaseAsync(dbName)
        );
        cashuLog.debug('cashu.manager.sqlite_opened', { dbName });
        const {
          db,
          migrationCount: preInitMigrationCount,
          migrationExpected,
        } = await initPhase('CocoManager.preInitSafetyRails', () =>
          this.runPreInitSafetyRails(opened, dbName)
        );
        this.db = db;
        const database = db as unknown as ExpoSqliteRepositoriesOptions['database'];
        // The profile's signer key is imported into coco's keyring (p2pk-import
        // plugin below) so P2PK receives auto-sign — but it must never reach
        // coco's plaintext SQLite keyring table. The overlay keeps it
        // in-memory for this manager session and scrubs legacy rows.
        const ephemeralKeyringPubkeys = new Set<string>();
        if (p2pkImportSecretKey) {
          ephemeralKeyringPubkeys.add(`02${getPublicKey(new Uint8Array(p2pkImportSecretKey))}`);
        }
        cashuLog.info('cashu.manager.repositories.create', {
          dbName,
          ephemeralKeyringCount: ephemeralKeyringPubkeys.size,
        });
        const repositories = createSovranCocoRepositories(
          new ExpoSqliteRepositories({ database }),
          { ephemeralKeyringPubkeys }
        );
        await initPhase('CocoManager.reposInit', () => repositories.init());
        cashuLog.debug('cashu.manager.repositories.ready', { dbName });
        // Post-init dump is diagnostic for migration boots only — skip the
        // extra sqlite_master scan on ordinary already-migrated boots.
        if (migrationExpected) {
          await this.logPostInitSchema(db, dbName, preInitMigrationCount);
        }

        // 2. Seed getter (lazy — no crypto work until first call, cached after)
        // Tries SecureStore seed cache first (~5ms) before falling back to PBKDF2 (~5s).
        const accountIndex = this.accountIndex;
        const isImported = this.isImportedProfile;
        const cashuMnemonic = this.cashuMnemonic;
        const seedGetter = createCashuSeedGetter({
          getMnemonic: async () => cashuMnemonic ?? (await retrieveMnemonic()),
          deriveSeed: (mnemonic) => {
            if (cashuMnemonic) {
              return deriveStandardCashuSeed(mnemonic);
            }

            const cashuChildMnemonic = isImported
              ? deriveCashuMnemonicForImported(mnemonic, accountIndex)
              : deriveCashuMnemonic(mnemonic, accountIndex);
            return deriveStandardCashuSeed(cashuChildMnemonic);
          },
          cache: {
            load: async ({ mnemonic }) => {
              const mnemonicHash = hashMnemonic(mnemonic);
              const cached = await retrieveCashuSeed(accountIndex);
              if (cached && cached.mnemonicHash === mnemonicHash) {
                initLog('CocoManager', 'seed loaded from SecureStore cache (skipped PBKDF2)');
                cashuLog.debug('cashu.manager.seed_cache.hit', { accountIndex });
                return cached.seed;
              }
              cashuLog.debug('cashu.manager.seed_cache.miss', {
                accountIndex,
                hadCachedSeed: !!cached,
              });
              return null;
            },
            store: (seed, { mnemonic }) => {
              const mnemonicHash = hashMnemonic(mnemonic);
              storeCashuSeed(accountIndex, seed, mnemonicHash)
                .then(() => cashuLog.debug('cashu.manager.seed_cache.stored', { accountIndex }))
                .catch((e) =>
                  cashuLog.warn('cashu.manager.seed_cache_store_failed', {
                    error: e instanceof Error ? e.message : String(e),
                  })
                );
            },
          },
        });

        this.seedGetter = seedGetter;
        cashuLog.debug('cashu.manager.seed_getter_ready', {
          accountIndex,
          importedProfile: isImported,
          hasInjectedCashuMnemonic: !!cashuMnemonic,
        });

        // 3. Core plugins. The P2PK import imports two kinds of key:
        //   - The active profile's signer snapshot (captured for THIS manager
        //     init). Never read a *stored* profile nsec here — that would let
        //     one profile's nsec leak into another profile's Coco database.
        //   - The shared, build-time GIVEAWAY_P2PK_SECRET (module constant
        //     above). This is intentionally global across all profiles so any
        //     install can redeem giveaway ecash; it is not a profile secret.
        const plugins: Plugin[] = [
          createP2PKImportPlugin({
            getSecretKeys: () => {
              const keys: P2PKSecretKeyInput[] = [];
              if (p2pkImportSecretKey) keys.push(new Uint8Array(p2pkImportSecretKey));
              if (GIVEAWAY_P2PK_SECRET) keys.push(GIVEAWAY_P2PK_SECRET);
              return keys;
            },
          }),
          // NUT-18 payment-request receive over Nostr: contributes the
          // nprofile transport block at create time and polls the gift-wrap
          // inbox for payloads while any request is active. Same
          // profile-snapshot key rule as the P2PK import above.
          createPaymentRequestNostrTransportPlugin({
            getSignerKey: () => (p2pkImportSecretKey ? new Uint8Array(p2pkImportSecretKey) : null),
          }),
        ];
        cashuLog.info('cashu.manager.plugins.configured', {
          pluginCount: plugins.length,
          hasProfileP2PKKey: !!p2pkImportSecretKey,
          hasGiveawayP2PK: !!GIVEAWAY_P2PK_SECRET,
        });

        // 4. Create Manager
        initLog('CocoManager', 'creating Manager instance...');
        // Always a creator, so every blinding call logs which implementation
        // ran it (cashu.output_data.created: impl/outputs/duration_ms). Native
        // CDK only behind EXPO_PUBLIC_CASHU_NATIVE_CRYPTO=1 plus a
        // byte-identical self-test; otherwise instrumented stock cashu-ts,
        // behaviorally identical to coco's own default.
        const outputDataCreator = resolveOutputDataCreator();

        this.instance = new Manager(
          repositories,
          seedGetter,
          new CocoCoreLogger('manager'),
          // undefined outside e2e mint-fault sessions → coco's own global-
          // WebSocket fallback, i.e. today's behavior exactly.
          maybeCreateMintFaultWebSocketFactory(),
          plugins,
          // watchers / processors / subscriptions keep their defaults;
          // outputDataCreator is the 9th positional parameter.
          undefined,
          undefined,
          undefined,
          outputDataCreator
        );
        await initPhase('CocoManager.initCorePlugins', () => this.instance!.initPlugins());
        initLog('CocoManager', 'Manager created');
        cashuLog.info('cashu.manager.initialized', {
          duration_ms: Math.round((performance.now() - initStart) * 100) / 100,
          accountIndex,
          dbName,
        });

        return this.instance;
      } catch (error) {
        cashuLog.error('cashu.manager.init_failed', { error });
        // Manager/repositories init failing is exactly what upstream needs
        // to hear about (schema migration or adapter contract breakage).
        reportCocoApiFailure('Manager.initialize/repositories.init', error, {
          dbName: this.getDbName(),
        });
        throw error;
      }
    };

    this.pendingInit = doInitialize();
    try {
      return await this.pendingInit;
    } finally {
      this.pendingInit = null;
    }
  }

  /**
   * Enable observe-only watchers and pre-warm the seed cache. Safe to call
   * before NUT-13 wallet restore has completed — does not start any operation
   * that uses the deterministic counter.
   */
  static async enableSafeWatchers(): Promise<void> {
    if (!this.instance) {
      cashuLog.warn('cashu.manager.safe_watchers.no_instance');
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    this.isBackgroundRunning = true;
    const t0 = performance.now();
    cashuLog.info('cashu.manager.safe_watchers.start');

    try {
      if (this.seedGetter) {
        await initPhase('CocoManager.seedCacheWarm', () => this.seedGetter!());
      } else {
        cashuLog.warn('cashu.manager.seed_cache_warm.skipped', { reason: 'missing_seed_getter' });
      }

      try {
        await initPhase('CocoManager.enableProofWatcher', () =>
          this.instance!.enableProofStateWatcher()
        );
      } catch (error) {
        cashuLog.warn('cashu.manager.proof_watcher_failed', { error });
        try {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await this.instance.enableProofStateWatcher();
          initLog('CocoManager', 'proof state watcher enabled on retry');
          cashuLog.info('cashu.manager.proof_watcher_retry_done');
        } catch (retryError) {
          cashuLog.error('cashu.manager.proof_watcher_retry_failed', { error: retryError });
          reportCocoApiFailure('enableProofStateWatcher', retryError);
        }
      }

      const e2eFundedAssets = process.env.EXPO_PUBLIC_E2E_FUNDED_ASSETS;
      if (
        __DEV__ &&
        process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT &&
        process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN &&
        e2eFundedAssets
      ) {
        try {
          const result = await initPhase('CocoManager.e2eReadyProofReconcile', () =>
            reconcileE2EReadyProofs(this.instance!, e2eFundedAssets)
          );
          cashuLog.info('cashu.manager.e2e_ready_proofs.done', {
            assets: result.assets,
            checked: result.checked,
            spent: result.spent,
            pending: result.pending,
            unspent: result.unspent,
            remainingAmount: result.remaining.reduce((sum, asset) => sum + asset.amount, 0),
          });
        } catch (error) {
          cashuLog.warn('cashu.manager.e2e_ready_proofs.failed', {
            error: error instanceof Error ? error.message : 'ready-proof reconciliation failed',
          });
          reportCocoApiFailure('e2eReadyProofReconcile', error);
        }
      }

      cashuLog.info('cashu.manager.safe_watchers.done', {
        duration_ms: Math.round((performance.now() - t0) * 100) / 100,
      });
    } finally {
      // Latch is paired with the matching set in enableNpcSyncAndProcessor —
      // clear here so that an exception or unmount mid-phase can't strand
      // the flag and permanently block profile switches.
      this.isBackgroundRunning = false;
    }
  }

  /**
   * Start the mint-operation watcher (with `watchExistingPendingOnStart`),
   * the mint-operation processor, and NPC sync. **Must NOT be called until the wallet
   * has restored its NUT-13 deterministic counter from the mint** — otherwise
   * any minting from a paid quote will use a counter the mint already signed,
   * triggering an `outputs already signed` rejection that retries forever
   * (see walletLifecycleStore + AppGate's RestoreGate).
   */
  static async enableNpcSyncAndProcessor(): Promise<void> {
    const manager = this.instance;
    if (!manager) {
      cashuLog.warn('cashu.manager.npc_sync_and_processor.no_instance');
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    this.isBackgroundRunning = true;
    const t0 = performance.now();
    cashuLog.info('cashu.manager.npc_sync_and_processor.start');

    try {
      let npcAccount: NPCAccountApi | null = null;
      try {
        initLog('CocoManager', 'initializing plugins...');
        const npcPlugin = this.getOrCreateNpcPlugin();
        if (!this.npcPluginRegistered) {
          manager.use(npcPlugin);
          this.npcPluginRegistered = true;
          cashuLog.info('cashu.manager.npc_plugin_registered');
        } else {
          cashuLog.debug('cashu.manager.npc_plugin_registration_skipped', {
            hasPlugin: true,
            alreadyRegistered: this.npcPluginRegistered,
          });
        }
        await manager.initPlugins();
        npcAccount = await this.getOrCreateNpcAccount();
        initLog('CocoManager', 'plugins initialized');
        cashuLog.info('cashu.manager.plugins_initialized', {
          hasNpcPlugin: true,
          hasNpcAccount: !!npcAccount,
        });
      } catch (error) {
        cashuLog.warn('cashu.manager.plugins_init_failed', { error });
      }

      try {
        initLog('CocoManager', 'reconciling legacy mint quotes...');
        const result = await manager.reconcileLegacyMintQuotes();
        cashuLog.info('cashu.manager.legacy_mint_quotes_reconciled', {
          reconciled: result.reconciled.length,
          skipped: result.skipped.length,
        });
      } catch (error) {
        cashuLog.warn('cashu.manager.legacy_mint_quote_reconcile_failed', { error });
        reportCocoApiFailure('reconcileLegacyMintQuotes', error);
      }

      try {
        initLog('CocoManager', 'enabling mint quote watcher...');
        await manager.enableMintOperationWatcher({
          watchExistingPendingOnStart: true,
          // v2: reusable bolt12/onchain quotes are watched as canonical quote
          // rows, not operations — rewatch those on start too.
          watchExistingPendingQuotesOnStart: true,
        });
        initLog('CocoManager', 'mint quote watcher enabled');
        cashuLog.info('cashu.manager.quote_watcher_enabled', {
          watchExistingPendingOnStart: true,
          watchExistingPendingQuotesOnStart: true,
        });
      } catch (error) {
        cashuLog.warn('cashu.manager.quote_watcher_failed', { error });
        reportCocoApiFailure('enableMintOperationWatcher', error);
      }

      try {
        initLog('CocoManager', 'enabling melt quote watcher...');
        await manager.enableMeltQuoteWatcher();
        initLog('CocoManager', 'melt quote watcher enabled');
        cashuLog.info('cashu.manager.melt_quote_watcher_enabled');
      } catch (error) {
        cashuLog.warn('cashu.manager.melt_quote_watcher_failed', { error });
        reportCocoApiFailure('enableMeltQuoteWatcher', error);
      }

      try {
        initLog('CocoManager', 'enabling mint quote processor...');
        await manager.enableMintOperationProcessor({
          processIntervalMs: 5000,
          maxRetries: 3,
          baseRetryDelayMs: 1000,
          initialEnqueueDelayMs: 2000,
        });
        initLog('CocoManager', 'mint quote processor enabled');
        cashuLog.info('cashu.manager.quote_processor_enabled', {
          processIntervalMs: 5000,
          maxRetries: 3,
        });
      } catch (error) {
        cashuLog.warn('cashu.manager.quote_processor_failed', { error });
        reportCocoApiFailure('enableMintOperationProcessor', error);
      }

      try {
        initLog('CocoManager', 'enabling melt settlement processor...');
        await manager.enableMeltSettlementProcessor();
        initLog('CocoManager', 'melt settlement processor enabled');
        cashuLog.info('cashu.manager.melt_settlement_processor_enabled');
      } catch (error) {
        cashuLog.warn('cashu.manager.melt_settlement_processor_failed', { error });
        reportCocoApiFailure('enableMeltSettlementProcessor', error);
      }

      try {
        initLog('CocoManager', 'recovering pending mint operations...');
        await manager.recoverPendingMintOperations();
        initLog('CocoManager', 'pending mint operation recovery done');
        cashuLog.info('cashu.manager.pending_mint_recovery_done');
      } catch (error) {
        cashuLog.warn('cashu.manager.pending_mint_recovery_failed', { error });
        reportCocoApiFailure('recoverPendingMintOperations', error);
      }

      try {
        const result = await manager.requeuePaidMintQuotes();
        if (result.requeued.length > 0) {
          cashuLog.info('cashu.manager.paid_mint_quotes_requeued', {
            requeued: result.requeued.length,
          });
        } else {
          cashuLog.debug('cashu.manager.paid_mint_quote_requeue_noop', {
            requeued: result.requeued.length,
          });
        }
      } catch (error) {
        cashuLog.warn('cashu.manager.paid_mint_quote_requeue_failed', { error });
        reportCocoApiFailure('requeuePaidMintQuotes', error);
      }

      if (npcAccount) {
        const timeoutMs = 15_000;
        initLog('CocoManager', 'NPC sync starting...');
        cashuLog.info('cashu.manager.npc_sync.start', { timeoutMs });
        let syncTimeout: ReturnType<typeof setTimeout> | null = null;
        const syncPromise = npcAccount.sync().then(
          () => {
            initLog('CocoManager', 'NPC sync done');
            cashuLog.info('cashu.manager.npc_sync.done');
          },
          (error) => cashuLog.warn('cashu.manager.npc_sync_failed', { error })
        );
        try {
          await Promise.race([
            syncPromise,
            new Promise<void>((resolve) => {
              syncTimeout = setTimeout(() => {
                cashuLog.warn('cashu.manager.npc_sync_timeout', { timeoutMs });
                resolve();
              }, timeoutMs);
            }),
          ]);
        } finally {
          if (syncTimeout) {
            clearTimeout(syncTimeout);
          }
        }
      }

      cashuLog.info('cashu.manager.npc_sync_and_processor.done', {
        duration_ms: Math.round((performance.now() - t0) * 100) / 100,
      });
    } finally {
      this.isBackgroundRunning = false;
    }
  }

  /**
   * Get the initialized Manager instance
   * Throws if not initialized
   */
  static getInstance(): Manager {
    if (!this.instance) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    return this.instance;
  }

  /**
   * Non-throwing instance peek. Used by lifecycle code (e.g. CocoProvider's
   * phase-2 background chain) to assert the manager it captured is still the
   * live instance before acting on the statics — a chain orphaned by a
   * profile-switch remount must not arm watchers/sync on the NEW profile's
   * manager (BTC-13).
   */
  static peekInstance(): Manager | null {
    return this.instance;
  }

  /**
   * Check if Manager is initialized
   */
  static isInitialized(): boolean {
    return this.instance !== null;
  }

  /**
   * True when the manager exists, is not mid-initialization, and has no pending cleanup.
   * Used by profile switching to determine if it's safe to tear down.
   */
  static isReadyForCleanup(): boolean {
    return this.getCleanupReadiness().ready;
  }

  /**
   * Component breakdown behind isReadyForCleanup — the profile-switch
   * refusal log needs WHICH condition is blocking, not a bare false (BTC-14).
   */
  static getCleanupReadiness(): {
    hasInstance: boolean;
    initInFlight: boolean;
    cleanupInFlight: boolean;
    backgroundRunning: boolean;
    ready: boolean;
  } {
    const parts = {
      hasInstance: this.instance !== null,
      initInFlight: this.pendingInit !== null,
      cleanupInFlight: this.pendingCleanup !== null,
      backgroundRunning: this.isBackgroundRunning,
    };
    return {
      ...parts,
      ready:
        parts.hasInstance &&
        !parts.initInFlight &&
        !parts.cleanupInFlight &&
        !parts.backgroundRunning,
    };
  }

  /**
   * Cleanup method to properly shutdown watchers and prevent transaction conflicts.
   *
   * Stores the promise in `pendingCleanup` so that a concurrent `initialize()` call
   * (e.g. from a new CocoProvider mounting during hot reload) can await it rather than
   * racing against an in-flight teardown.
   */
  static async cleanup(): Promise<void> {
    // Dedup concurrent cleanups: a second call returns the existing promise
    // rather than overwriting it. Without this, an initialize() awaiter that
    // sampled `pendingCleanup` only sees the second teardown and can race the
    // still-running first one (db.closeAsync / repository teardown).
    if (this.pendingCleanup) {
      cashuLog.info('cashu.manager.cleanup_join_pending');
      return this.pendingCleanup;
    }

    const doCleanup = async () => {
      if (!this.instance) {
        this.clearSensitiveRuntimeState();
        cashuLog.debug('cashu.manager.cleanup_skipped', { reason: 'no_instance' });
        return;
      }

      try {
        cashuLog.info('cashu.manager.cleanup_start');

        // Disable watchers in reverse order to prevent conflicts
        try {
          await this.instance.disableProofStateWatcher();
          cashuLog.debug('cashu.manager.proof_watcher_disabled');
        } catch (error) {
          cashuLog.warn('cashu.manager.proof_watcher_disable_failed', { error });
        }

        try {
          await this.instance.disableMintOperationProcessor();
          cashuLog.debug('cashu.manager.quote_processor_disabled');
        } catch (error) {
          cashuLog.warn('cashu.manager.quote_processor_disable_failed', { error });
        }

        try {
          await this.instance.disableMintOperationWatcher();
          cashuLog.debug('cashu.manager.quote_watcher_disabled');
        } catch (error) {
          cashuLog.warn('cashu.manager.quote_watcher_disable_failed', { error });
        }

        try {
          await this.instance.disableMeltSettlementProcessor();
          await this.instance.disableMeltQuoteWatcher();
          cashuLog.debug('cashu.manager.melt_watchers_disabled');
        } catch (error) {
          cashuLog.warn('cashu.manager.melt_watchers_disable_failed', { error });
        }

        try {
          await this.instance.dispose();
          cashuLog.debug('cashu.manager.disposed');
        } catch (error) {
          cashuLog.warn('cashu.manager.dispose_failed', { error });
        }

        // Close the SQLite connection to prevent "database is locked" on revisit
        if (this.db) {
          const db = this.db;
          this.db = null;
          try {
            await db.closeAsync();
            cashuLog.debug('cashu.manager.sqlite_closed');
          } catch (error) {
            // Already closed (e.g. hot reload or rapid profile switch) — safe to ignore
            cashuLog.debug('cashu.manager.sqlite_close_skipped', {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Clear the instance
        this.instance = null;
        this.clearSensitiveRuntimeState();
        cashuLog.info('cashu.manager.cleanup_done');
      } catch (error) {
        cashuLog.error('cashu.manager.cleanup_failed', { error });
        // Null the instance on a partially-failed cleanup too — leaving it
        // set makes the next initialize() hand out a disposed Manager
        // (reuse-after-dispose: every guarded coco call then throws
        // "Cannot … after disposal has started"). The DB is closed and
        // sensitive state cleared either way; the instance is unusable.
        this.instance = null;
        if (this.db) {
          try {
            await this.db.closeAsync();
          } catch {
            // best-effort
          }
          this.db = null;
        }
        this.clearSensitiveRuntimeState();
      }
    };

    this.pendingCleanup = doCleanup();
    try {
      await this.pendingCleanup;
    } finally {
      this.pendingCleanup = null;
    }
  }

  private static getOrCreateNpcPlugin(): NPCPlugin {
    if (this.npcPlugin) return this.npcPlugin;

    // v3 plugin: host-level registration only — signers, sync timers, and
    // websocket subscriptions belong to per-profile account runtimes added
    // via getOrCreateNpcAccount() after initPlugins().
    this.npcPlugin = new NPCPlugin({
      defaultBaseUrl: NPC_BASE_URL,
      syncIntervalMs: NPC_SYNC_INTERVAL_MS,
      useWebsocket: true,
      // Without a logger the plugin's interval syncs, websocket lifecycle, and
      // claim failures are invisible — a stranded npc receive left no trace.
      logger: new CocoCoreLogger('npc'),
    });
    initLog('CocoManager', 'NPC plugin created');
    return this.npcPlugin;
  }

  private static async getOrCreateNpcAccount(): Promise<NPCAccountApi | null> {
    if (this.npcAccount) return this.npcAccount;
    if (!this.npcPlugin) return null;

    const nsecSigner = await initPhase('CocoManager.getSigner', () =>
      this.getCurrentProfileSigner()
    );
    initLog('CocoManager', `signer created: ${!!nsecSigner}`);

    if (!nsecSigner) return null;

    // NpcSigner is `(t: EventTemplate) => Promise<SignedEvent>` from
    // npubcash-sdk; the underlying NsecSigner.signEvent is the same shape
    // via nostr-tools, so we re-type the param at the boundary.
    const signerFunction: NpcSigner = (eventTemplate) =>
      nsecSigner.signEvent(eventTemplate as EventTemplate);

    // Resolve the active profile's pubkey so the sync cursor is pubkey-keyed
    // (not accountIndex-keyed); guards against index recycling when the
    // highest-numbered profile is deleted.
    const { useProfileStore } = await import('@/shared/stores/global/profileStore');
    const activePubkey = useProfileStore.getState().getActiveProfile()?.pubkey;

    if (!activePubkey) {
      cashuLog.warn('cashu.manager.npc_skip_no_pubkey');
      return null;
    }

    this.npcAccount = await this.npcPlugin.addAccount({
      id: activePubkey,
      signer: signerFunction,
      baseUrl: NPC_BASE_URL,
      sinceStore: new AsyncStorageSinceStore(getNpcSinceStoreKey(activePubkey)),
      // autoStart arms the interval timer + websocket for this account.
      autoStart: true,
    });
    initLog('CocoManager', 'NPC account added');
    await this.ensureNpcQuotesUnlocked(this.npcAccount, signerFunction);
    return this.npcAccount;
  }

  /**
   * Make sure npub.cash issues UNLOCKED mint quotes for this account.
   *
   * A NUT-20 locked quote can only be minted by signing with the pubkey the
   * quote is locked to, and this app deliberately refuses to serve a key for
   * that purpose — `cocoRepositories`' keyring overlay never answers a
   * `nut20_mint_quote` query, because doing so would NUT-20-sign a mint quote
   * with the profile identity key. So a locked quote is not slow, it is
   * permanently unmintable: coco throws `MintQuoteKeyError` on every attempt.
   *
   * That would be survivable if it cost only the one payment, but it does not.
   * The plugin's watermark is failure-safe — it advances `since` only up to the
   * LOWEST failed `paidAt` — so one locked quote pins the cursor and every
   * later receive stalls behind it. The whole lane stops.
   *
   * The server-side switch is the fix: `lockQuotes: false` and quotes arrive
   * mintable. Read before writing so the common case costs one GET and no
   * write. Never throws — a failure here means we might meet a locked quote
   * later, which is strictly better than blocking wallet startup on a
   * third-party HTTP call, and the next launch retries.
   *
   * This is defensive, not a fix for anything observed. Checked 2026-08-18: no
   * shipping client sets `lockQuotes` — cashu.me reads the field and never
   * calls `setLock`, and npub.cash's own website and npubcash-cli reference
   * neither `lockQuotes` nor `/api/v2/user/lock`. The docs describe it as an
   * opt-in user setting with no stated default. So the true branch is
   * currently unreachable; it is here because the flag is server-side and
   * sticky, this app has no UI to clear it, and the failure it would cause is
   * a silent total stall rather than one lost payment. Delete it if upstream
   * ever guarantees quotes are never locked for wallets that cannot sign.
   */
  private static async ensureNpcQuotesUnlocked(
    account: NPCAccountApi,
    signer: NpcSigner
  ): Promise<void> {
    try {
      const info = await account.getInfo();
      if (!info.lockQuote) {
        cashuLog.debug('cashu.manager.npc_quotes_already_unlocked');
        return;
      }
      cashuLog.warn('cashu.manager.npc_quotes_locked_disabling');
      await createNpcClient(signer).settings.setLock(false);
      cashuLog.info('cashu.manager.npc_quotes_unlocked');
    } catch (error) {
      cashuLog.warn('cashu.manager.npc_unlock_check_failed', { error: redactError(error) });
    }
  }

  /**
   * Get the current profile's signer for NPC plugin.
   * Uses the pre-set signerKey when available (fast path), falling back
   * to deriving from the mnemonic if setSignerKey() was never called.
   */
  private static async getCurrentProfileSigner(): Promise<NsecSigner | null> {
    try {
      if (this.signerKey) {
        initLog('CocoManager', 'using pre-set signerKey (fast path)');
        return new NsecSigner(this.signerKey);
      }

      if (this.isImportedProfile) {
        initLog('CocoManager', 'signerKey not set — loading imported nsec (slow path)');
        const { useProfileStore } = await import('@/shared/stores/global/profileStore');
        const activeProfile = useProfileStore.getState().getActiveProfile();
        if (!activeProfile) {
          cashuLog.warn('cashu.manager.no_active_profile');
          return null;
        }
        const { retrieveImportedNsec } = await import('@/shared/lib/nostr/secureStorage');
        const { nip19 } = await import('nostr-tools');
        const nsecValue = await retrieveImportedNsec(activeProfile.pubkey);
        if (!nsecValue) {
          cashuLog.warn('cashu.manager.nsec_not_found');
          return null;
        }
        const decoded = nip19.decode(nsecValue);
        if (decoded.type !== 'nsec') return null;
        return new NsecSigner(decoded.data);
      }

      initLog('CocoManager', 'signerKey not set — deriving from mnemonic (slow path)');
      const mnemonic = await retrieveMnemonic();
      if (!mnemonic) {
        cashuLog.warn('cashu.manager.no_mnemonic');
        return null;
      }

      const { privateKey } = deriveNostrKeys(mnemonic, this.accountIndex);
      return new NsecSigner(privateKey);
    } catch (error) {
      cashuLog.error('cashu.manager.signer_creation_failed', { error });
      return null;
    }
  }

  /** Safely disable all watchers before tearing down the Manager. */
  private static async disableWatchers(): Promise<void> {
    if (!this.instance) return;
    try {
      await this.instance.disableProofStateWatcher();
      cashuLog.debug('cashu.manager.proof_watcher_disabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.proof_watcher_disable_failed', { error });
    }

    try {
      await this.instance.disableMintOperationWatcher();
      cashuLog.debug('cashu.manager.quote_watcher_disabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.quote_watcher_disable_failed', { error });
    }

    try {
      await this.instance.disableMintOperationProcessor();
      cashuLog.debug('cashu.manager.quote_processor_disabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.quote_processor_disable_failed', { error });
    }

    try {
      await this.instance.disableMeltSettlementProcessor();
      await this.instance.disableMeltQuoteWatcher();
      cashuLog.debug('cashu.manager.melt_watchers_disabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.melt_watchers_disable_failed', { error });
    }
  }

  /**
   * Delete a single coco database by name.
   */
  private static async deleteDatabase(dbName: string): Promise<void> {
    const { dbPath, backupPath, backupSidecars } = this.getDbPaths(dbName);
    try {
      await SQLite.deleteDatabaseAsync(dbName);
      cashuLog.info('cashu.manager.db_deleted', { dbName });
    } catch (error) {
      cashuLog.warn('cashu.manager.db_delete_failed', { dbName, error });
      try {
        const filesToDelete = [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`];
        for (const filePath of filesToDelete) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
        cashuLog.info('cashu.manager.db_deleted_fallback', { dbName });
      } catch (fsError) {
        cashuLog.warn('cashu.manager.db_delete_fallback_failed', { dbName, error: fsError });
      }
    }

    // Pre-v2 migration backups hold spendable proofs — account deletion must
    // remove them along with the live database.
    try {
      for (const filePath of [backupPath, ...backupSidecars]) {
        await FileSystem.deleteAsync(filePath, { idempotent: true });
      }
      cashuLog.debug('cashu.manager.db_backup_deleted', { dbName });
    } catch (error) {
      cashuLog.warn('cashu.manager.db_backup_delete_failed', { dbName, error });
    }
  }

  /**
   * Complete reset: delete ALL coco databases (all profiles including imported)
   * and reset the manager. Used for "Delete Account" / full app reset.
   * @param accountIndexes All profile account indexes (derived 0,1,2... and imported npubNumbers).
   */
  static async completeReset(accountIndexes: number[]): Promise<void> {
    try {
      await this.disableWatchers();
      if (this.instance) {
        try {
          await this.instance.dispose();
          cashuLog.debug('cashu.manager.disposed');
        } catch (error) {
          cashuLog.warn('cashu.manager.dispose_failed', { error });
        }
      }
      this.instance = null;
      this.pendingInit = null;

      const dbNames = new Set<string>();
      for (const i of accountIndexes) {
        dbNames.add(i === 0 ? 'coco.db' : `coco-${i}.db`);
      }
      for (const dbName of dbNames) {
        await this.deleteDatabase(dbName);
      }

      this.clearSensitiveRuntimeState();
      cashuLog.info('cashu.manager.reset_done');
    } catch (error) {
      cashuLog.error('cashu.manager.reset_failed', { error });
      throw error;
    }
  }

  static async exportDatabase(): Promise<string> {
    const dbName = this.getDbName();
    const dbDirectory = FileSystem.documentDirectory;
    const dbPath = `${dbDirectory}SQLite/${dbName}`;

    // Copy to a shareable location
    const exportPath = `${dbDirectory}coco-export.db`;

    // Also copy WAL file if it exists (contains uncommitted transactions)
    const walPath = `${dbPath}-wal`;

    try {
      await FileSystem.copyAsync({
        from: dbPath,
        to: exportPath,
      });

      // Try to copy WAL file too
      try {
        const walInfo = await FileSystem.getInfoAsync(walPath);
        if (walInfo.exists) {
          await FileSystem.copyAsync({
            from: walPath,
            to: `${exportPath}-wal`,
          });
        }
      } catch {
        // WAL might not exist, that's okay
      }

      cashuLog.info('cashu.manager.db_exported', { exportPath });

      // Share the file
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(exportPath, {
          mimeType: 'application/x-sqlite3',
          dialogTitle: 'Export Coco Database',
        });
      }

      return exportPath;
    } catch (error) {
      cashuLog.error('cashu.manager.db_export_failed', { error });
      throw error;
    }
  }

  /**
   * Restore inflight proofs to "ready" state for a specific mint.
   *
   * Call this after a melt operation fails (e.g. no_route, timeout) to ensure
   * proofs don't remain stuck in "inflight" state. This is the application-level
   * equivalent of the "Restore Inflight" button in the debug panel, scoped to a
   * single mint.
   *
   * Safe to call even when no inflight proofs exist — it's a no-op.
   */
  static async restoreInflightProofsForMint(mintUrl: string): Promise<number> {
    const manager = this.getInstance();

    try {
      cashuLog.info('cashu.manager.proofs_restore_start', { ...mintUrlLogFields(mintUrl) });
      const inflight = await getInflightProofs(manager, [mintUrl]);
      if (inflight.length === 0) {
        cashuLog.debug('cashu.manager.proofs_restore_noop', { ...mintUrlLogFields(mintUrl) });
        return 0;
      }

      const secrets = inflight.map((p) => p.secret);
      await restoreProofsToReady(manager, mintUrl, secrets);
      cashuLog.info('cashu.manager.proofs_restored', {
        count: secrets.length,
        ...mintUrlLogFields(mintUrl),
      });
      return secrets.length;
    } catch (err) {
      cashuLog.warn('cashu.manager.proofs_restore_failed', { error: err });
      return 0;
    }
  }
}
