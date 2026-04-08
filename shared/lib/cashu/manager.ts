import { Manager } from '@cashu/coco-core';
import { CocoLogger } from './cocoLogger';
import { ExpoSqliteRepositories } from '@cashu/coco-expo-sqlite';
import * as SQLite from 'expo-sqlite';
import {
  retrieveMnemonic,
  retrieveCashuSeed,
  storeCashuSeed,
  hashMnemonic,
} from '@/shared/lib/nostr/secureStorage';
import { NPCPlugin } from 'coco-cashu-plugin-npc';
import {
  deriveNostrKeys,
  deriveCashuWalletSeed,
  deriveCashuWalletSeedFromRoot,
  deriveCashuWalletSeedForImported,
} from '@/shared/lib/nostr/keyDerivation';
import * as FileSystem from 'expo-file-system/legacy';
import { EventTemplate, finalizeEvent, VerifiedEvent } from 'nostr-tools';
import * as Sharing from 'expo-sharing';
import { cashuLog, initLog } from '../logger';

interface Signer {
  signEvent: (e: EventTemplate) => Promise<VerifiedEvent>;
}

export class NsecSigner implements Signer {
  secretKey: Uint8Array;

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
 * This replaces the complex Redux-based cashuClient.ts approach
 */
export class CocoManager {
  private static instance: Manager | null = null;
  private static db: SQLite.SQLiteDatabase | null = null;
  private static isInitializing = false;
  /** True while enableWatchersAndSync / recovery / default mint init are running. */
  private static isBackgroundRunning = false;
  /** Tracks an in-flight cleanup() call so initialize() can await it before proceeding. */
  private static pendingCleanup: Promise<void> | null = null;
  private static cashuMnemonic: string | null = null;
  private static signerKey: Uint8Array | null = null;
  private static npcPlugin: NPCPlugin | null = null;
  private static isFreeingReservedProofs = false;
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
  }

  /** Get the SQLite database name for the current account index */
  private static getDbName(): string {
    return this.accountIndex === 0 ? 'coco.db' : `coco-${this.accountIndex}.db`;
  }

  /**
   * Set the cashu mnemonic from NostrKeysProvider
   * This should be called before initialize()
   */
  static setCashuMnemonic(mnemonic: string): void {
    this.cashuMnemonic = mnemonic;
  }

  /**
   * Set the Nostr private key so getCurrentProfileSigner() can skip derivation.
   * Called from CocoProvider with the key already derived by NostrKeysProvider.
   */
  static setSignerKey(sk: Uint8Array): void {
    this.signerKey = sk;
  }

  /**
   * Initialize the Coco Manager with database and seed management.
   * This creates the Manager instance only — no network calls, no watchers.
   * Call {@link enableWatchersAndSync} separately (in a non-blocking phase)
   * to start watchers, processors, and the initial NPC sync.
   */
  static async initialize(): Promise<Manager> {
    // If a cleanup() call is still running (e.g. fire-and-forget from CocoProvider
    // unmount during hot reload), wait for it to finish before we decide whether
    // to return the existing instance or start a fresh one.
    if (this.pendingCleanup) {
      initLog('CocoManager', 'cleanup in progress, waiting before initialize...');
      await this.pendingCleanup;
    }

    if (this.instance) {
      initLog('CocoManager', 'already initialized, returning existing instance');
      return this.instance;
    }

    if (this.isInitializing) {
      initLog('CocoManager', 'initialization in progress, waiting...');
      let attempts = 0;
      while (this.isInitializing && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
      if (this.instance) return this.instance;
      if (attempts >= 50) throw new Error('Manager initialization timeout');
    }

    this.isInitializing = true;
    this.instance = null;
    const initStart = performance.now();

    try {
      // 1. SQLite database (async to avoid blocking JS thread during profile switch)
      const dbName = this.getDbName();
      initLog('CocoManager', `opening DB: ${dbName}`);
      const db = await SQLite.openDatabaseAsync(dbName);
      this.db = db;
      const repositories = new ExpoSqliteRepositories({ database: db });
      await repositories.init();
      initLog('CocoManager', 'DB + repos initialized');

      // 2. Seed getter (lazy — no crypto work until first call, cached after)
      // Tries SecureStore seed cache first (~5ms) before falling back to PBKDF2 (~5s).
      const accountIndex = this.accountIndex;
      const isImported = this.isImportedProfile;
      let cachedSeed: Uint8Array | null = null;
      const seedGetter = async (): Promise<Uint8Array> => {
        if (cachedSeed) return cachedSeed;

        // Fast path: check SecureStore for a previously derived seed
        const mnemonicForHash = this.cashuMnemonic ?? (await retrieveMnemonic());
        const mHash = mnemonicForHash ? hashMnemonic(mnemonicForHash) : null;
        if (mHash) {
          const cached = await retrieveCashuSeed(accountIndex);
          if (cached && cached.mnemonicHash === mHash) {
            initLog('CocoManager', 'seed loaded from SecureStore cache (skipped PBKDF2)');
            cachedSeed = cached.seed;
            return cached.seed;
          }
        }

        // Slow path: derive via PBKDF2
        let seed: Uint8Array;
        if (this.cashuMnemonic) {
          seed = deriveCashuWalletSeed(this.cashuMnemonic);
        } else {
          const mnemonic = mnemonicForHash ?? (await retrieveMnemonic());
          if (!mnemonic) throw new Error('No mnemonic found in secure storage');
          if (isImported) {
            seed = deriveCashuWalletSeedForImported(mnemonic, accountIndex);
          } else {
            seed = deriveCashuWalletSeedFromRoot(mnemonic, accountIndex);
          }
        }
        cachedSeed = seed;

        // Persist for next cold start (fire-and-forget)
        if (mHash) {
          storeCashuSeed(accountIndex, seed, mHash).catch((e) =>
            cashuLog.warn('cashu.manager.seed_cache_store_failed', { error: e })
          );
        }

        return seed;
      };

      this.seedGetter = seedGetter;

      // 3. NPC plugin (constructor only — no network call)
      const plugins: any[] = [];
      initLog('CocoManager', 'creating signer...');
      const nsecSigner = await this.getCurrentProfileSigner();
      initLog('CocoManager', `signer created: ${!!nsecSigner}`);

      if (nsecSigner) {
        const signerFunction = async (eventTemplate: any) => {
          return await nsecSigner.signEvent(eventTemplate);
        };
        this.npcPlugin = new NPCPlugin('https://npubx.cash', signerFunction, {
          syncIntervalMs: 30000,
          useWebsocket: true,
        });
        plugins.push(this.npcPlugin);
        initLog('CocoManager', 'NPC plugin created');
      }

      // 4. Create Manager
      initLog('CocoManager', 'creating Manager instance...');
      this.instance = new Manager(
        repositories,
        seedGetter,
        new CocoLogger('manager'),
        undefined,
        plugins
      );
      initLog('CocoManager', 'Manager created');
      cashuLog.info('cashu.manager.initialized', {
        duration_ms: Math.round((performance.now() - initStart) * 100) / 100,
      });

      return this.instance;
    } catch (error) {
      cashuLog.error('cashu.manager.init_failed', { error });
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Enable watchers, processors, and run initial NPC sync.
   * Safe to call from a non-blocking background phase — these involve
   * network I/O and DB transactions that don't need to block app startup.
   */
  static async enableWatchersAndSync(): Promise<void> {
    if (!this.instance) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    this.isBackgroundRunning = true;
    const syncStart = performance.now();
    cashuLog.info('cashu.manager.watchers_sync.start');

    // Start NPC sync first (dispatches native HTTP), then pre-warm seed.
    // The synchronous PBKDF2 (~2.5s) runs while the native layer handles NPC HTTP I/O,
    // so the seed is cached before recovery needs it — no JS thread freeze during usage.
    const npcPromise = this.npcPlugin
      ? this.npcPlugin.sync().then(
          () => initLog('CocoManager', 'NPC sync done'),
          (error) => cashuLog.warn('cashu.manager.npc_sync_failed', { error })
        )
      : Promise.resolve();
    initLog('CocoManager', 'NPC sync starting...');

    if (this.seedGetter) {
      initLog('CocoManager', 'pre-warming seed cache...');
      await this.seedGetter();
      initLog('CocoManager', 'seed cache warmed');
    }

    await npcPromise;

    // Mint quote watcher
    try {
      initLog('CocoManager', 'enabling mint quote watcher...');
      await this.instance.enableMintOperationWatcher({ watchExistingPendingOnStart: true });
      initLog('CocoManager', 'mint quote watcher enabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.quote_watcher_failed', { error });
    }

    // Mint quote processor
    try {
      initLog('CocoManager', 'enabling mint quote processor...');
      await this.instance.enableMintOperationProcessor({
        processIntervalMs: 5000,
        maxRetries: 3,
        baseRetryDelayMs: 1000,
        initialEnqueueDelayMs: 2000,
      });
      initLog('CocoManager', 'mint quote processor enabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.quote_processor_failed', { error });
    }

    // Proof state watcher
    try {
      initLog('CocoManager', 'enabling proof state watcher...');
      await this.instance.enableProofStateWatcher();
      initLog('CocoManager', 'proof state watcher enabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.proof_watcher_failed', { error });
      try {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await this.instance.enableProofStateWatcher();
        initLog('CocoManager', 'proof state watcher enabled on retry');
      } catch (retryError) {
        cashuLog.error('cashu.manager.proof_watcher_retry_failed', { error: retryError });
      }
    }

    this.isBackgroundRunning = false;
    cashuLog.info('cashu.manager.watchers_sync.done', {
      duration_ms: Math.round((performance.now() - syncStart) * 100) / 100,
    });
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
    return (
      this.instance !== null &&
      !this.isInitializing &&
      !this.pendingCleanup &&
      !this.isBackgroundRunning
    );
  }

  /**
   * Cleanup method to properly shutdown watchers and prevent transaction conflicts.
   *
   * Stores the promise in `pendingCleanup` so that a concurrent `initialize()` call
   * (e.g. from a new CocoProvider mounting during hot reload) can await it rather than
   * racing against an in-flight teardown.
   */
  static async cleanup(): Promise<void> {
    const doCleanup = async () => {
      if (!this.instance) {
        this.clearSensitiveRuntimeState();
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

        // Close the SQLite connection to prevent "database is locked" on revisit
        if (this.db) {
          const db = this.db;
          this.db = null;
          try {
            await db.closeAsync();
            cashuLog.debug('cashu.manager.sqlite_closed');
          } catch {
            // Already closed (e.g. hot reload or rapid profile switch) — safe to ignore
          }
        }

        // Clear the instance
        this.instance = null;
        this.clearSensitiveRuntimeState();
        cashuLog.info('cashu.manager.cleanup_done');
      } catch (error) {
        cashuLog.error('cashu.manager.cleanup_failed', { error });
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

  /**
   * Enable ProofStateWatcher separately to avoid transaction conflicts
   */
  static async enableProofStateWatcher(): Promise<void> {
    if (!this.instance) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }

    try {
      await this.instance.enableProofStateWatcher();
      cashuLog.debug('cashu.manager.proof_watcher_enabled');
    } catch (error) {
      cashuLog.warn('cashu.manager.proof_watcher_enable_failed', { error });
      throw error;
    }
  }

  /**
   * Safely disable all watchers before resetting
   */
  static async disableWatchers(): Promise<void> {
    if (this.instance) {
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
    }
  }

  /**
   * Delete a single coco database by name.
   */
  private static async deleteDatabase(dbName: string): Promise<void> {
    try {
      await SQLite.deleteDatabaseAsync(dbName);
      cashuLog.info('cashu.manager.db_deleted', { dbName });
    } catch (error) {
      cashuLog.warn('cashu.manager.db_delete_failed', { dbName, error });
      try {
        const dbDirectory = FileSystem.documentDirectory;
        const dbPath = `${dbDirectory}SQLite/${dbName}`;
        const filesToDelete = [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`];
        for (const filePath of filesToDelete) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
        cashuLog.info('cashu.manager.db_deleted_fallback', { dbName });
      } catch (fsError) {
        cashuLog.warn('cashu.manager.db_delete_fallback_failed', { dbName, error: fsError });
      }
    }
  }

  /**
   * Clear all data from the SQLite database (current account only).
   * This will delete the entire database file and all associated files.
   */
  static async clearAllData(): Promise<void> {
    try {
      if (this.instance) {
        await this.disableWatchers();
        this.instance = null;
        this.isInitializing = false;
      }
      const dbName = this.getDbName();
      await this.deleteDatabase(dbName);
    } catch (error) {
      cashuLog.error('cashu.manager.clear_data_failed', { error });
      throw error;
    }
  }

  /**
   * Reset the manager (useful for testing or logout)
   */
  static async reset(): Promise<void> {
    await this.disableWatchers();
    this.instance = null;
    this.clearSensitiveRuntimeState();
    this.isInitializing = false;
  }

  /**
   * Complete reset: delete ALL coco databases (all profiles including imported)
   * and reset the manager. Used for "Delete Account" / full app reset.
   * @param accountIndexes All profile account indexes (derived 0,1,2... and imported npubNumbers).
   */
  static async completeReset(accountIndexes: number[]): Promise<void> {
    try {
      if (this.instance) {
        await this.disableWatchers();
        this.instance = null;
        this.isInitializing = false;
      }

      const dbNames = new Set<string>();
      for (const i of accountIndexes) {
        dbNames.add(i === 0 ? 'coco.db' : `coco-${i}.db`);
      }
      for (const dbName of dbNames) {
        await this.deleteDatabase(dbName);
      }

      await this.reset();
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
   * Find all currently reserved (ready + usedByOperationId) proofs and free them.
   *
   * Strategy:
   * - Group reserved proofs by `usedByOperationId`
   * - If the operation is a **send** op, use the public API: `manager.send.rollback(operationId)`
   * - If the operation is a **melt** op, use the underlying service rollback (not currently exposed
   *   on `QuotesApi`) via a safe runtime access.
   * - If the operation no longer exists, release the reservations directly via the proof repository.
   *
   * This is intended as a manual recovery tool for “stuck reserved balance”.
   */
  static async freeAllReservedProofs(): Promise<{
    totalReservedProofs: number;
    rolledBackSendOperations: number;
    rolledBackMeltOperations: number;
    releasedOrphanedReservations: number;
    errors: { operationId: string; reason: string }[];
  }> {
    if (this.isFreeingReservedProofs) {
      throw new Error('Reserved proof recovery is already running');
    }

    this.isFreeingReservedProofs = true;
    const manager = this.getInstance();

    try {
      const proofRepository = manager.proofRepository;
      const proofService = manager.proofService;

      if (!proofRepository?.getReservedProofs || !proofRepository?.releaseProofs) {
        throw new Error('Coco proof repository does not expose reserved proof access');
      }

      const reservedProofs = await proofRepository.getReservedProofs();
      const totalReservedProofs = reservedProofs.length;

      if (totalReservedProofs === 0) {
        return {
          totalReservedProofs: 0,
          rolledBackSendOperations: 0,
          rolledBackMeltOperations: 0,
          releasedOrphanedReservations: 0,
          errors: [],
        };
      }

      const proofsByOperationId = new Map<
        string,
        { mintUrl: string; secret: string; usedByOperationId?: string }[]
      >();
      const noOperationId: { mintUrl: string; secret: string }[] = [];

      for (const p of reservedProofs) {
        const opId = p.usedByOperationId;
        if (!opId) {
          noOperationId.push({ mintUrl: p.mintUrl, secret: p.secret });
          continue;
        }
        const existing = proofsByOperationId.get(opId) ?? [];
        existing.push(p);
        proofsByOperationId.set(opId, existing);
      }

      let rolledBackSendOperations = 0;
      let rolledBackMeltOperations = 0;
      let releasedOrphanedReservations = 0;
      const errors: { operationId: string; reason: string }[] = [];
      const meltOperationService = manager.meltOperationService;

      // Release any “corrupt” reserved rows that somehow lack an operationId.
      if (noOperationId.length > 0) {
        const byMint = new Map<string, string[]>();
        for (const p of noOperationId) {
          const list = byMint.get(p.mintUrl) ?? [];
          list.push(p.secret);
          byMint.set(p.mintUrl, list);
        }
        for (const [mintUrl, secrets] of byMint.entries()) {
          if (secrets.length === 0) continue;
          if (proofService?.releaseProofs) {
            await proofService.releaseProofs(mintUrl, secrets);
          } else {
            await proofRepository.releaseProofs(mintUrl, secrets);
          }
          releasedOrphanedReservations += secrets.length;
        }
      }

      for (const [operationId, proofs] of proofsByOperationId.entries()) {
        try {
          // Prefer “proper rollback” (it may need to swap/recover), rather than simply unreserving.
          const sendOp = (await manager.ops.send.get(operationId).catch(() => null)) as {
            state?: string;
          } | null;
          if (sendOp) {
            // Skip rollback for terminal states (finalized, rolled_back) - just release proofs
            const terminalStates = new Set(['finalized', 'rolled_back']);
            if (terminalStates.has(sendOp.state ?? '')) {
              const secretsByMint = new Map<string, string[]>();
              for (const p of proofs) {
                const list = secretsByMint.get(p.mintUrl) ?? [];
                list.push(p.secret);
                secretsByMint.set(p.mintUrl, list);
              }
              for (const [mintUrl, secrets] of secretsByMint.entries()) {
                if (secrets.length === 0) continue;
                if (proofService?.releaseProofs) {
                  await proofService.releaseProofs(mintUrl, secrets);
                } else {
                  await proofRepository.releaseProofs(mintUrl, secrets);
                }
                releasedOrphanedReservations += secrets.length;
              }
              continue;
            }
            if (sendOp.state === 'prepared') {
              await manager.ops.send.cancel(operationId);
            } else {
              await manager.ops.send.reclaim(operationId);
            }
            rolledBackSendOperations++;
            continue;
          }

          const meltOp = meltOperationService?.getOperation
            ? ((await meltOperationService.getOperation(operationId).catch(() => null)) as {
                state?: string;
              } | null)
            : null;
          if (meltOp) {
            // Skip rollback for terminal states (finalized, rolled_back) - just release proofs
            const meltTerminalStates = new Set(['finalized', 'rolled_back']);
            if (meltTerminalStates.has(meltOp.state ?? '')) {
              const secretsByMint = new Map<string, string[]>();
              for (const p of proofs) {
                const list = secretsByMint.get(p.mintUrl) ?? [];
                list.push(p.secret);
                secretsByMint.set(p.mintUrl, list);
              }
              for (const [mintUrl, secrets] of secretsByMint.entries()) {
                if (secrets.length === 0) continue;
                if (proofService?.releaseProofs) {
                  await proofService.releaseProofs(mintUrl, secrets);
                } else {
                  await proofRepository.releaseProofs(mintUrl, secrets);
                }
                releasedOrphanedReservations += secrets.length;
              }
              continue;
            }
            if (!meltOperationService?.rollback) {
              throw new Error('Melt rollback is unavailable');
            }
            await meltOperationService.rollback(operationId, 'Manual rollback via settings');
            rolledBackMeltOperations++;
            continue;
          }

          // Orphaned reservation: operation no longer exists (or was never persisted).
          // Release reservations (prefer ProofService so events fire).
          const secretsByMint = new Map<string, string[]>();
          for (const p of proofs) {
            const list = secretsByMint.get(p.mintUrl) ?? [];
            list.push(p.secret);
            secretsByMint.set(p.mintUrl, list);
          }

          for (const [mintUrl, secrets] of secretsByMint.entries()) {
            if (secrets.length === 0) continue;
            if (proofService?.releaseProofs) {
              await proofService.releaseProofs(mintUrl, secrets);
            } else {
              await proofRepository.releaseProofs(mintUrl, secrets);
            }
            releasedOrphanedReservations += secrets.length;
          }
        } catch (e) {
          errors.push({
            operationId,
            reason: e instanceof Error ? e.message : String(e),
          });
        }
      }

      return {
        totalReservedProofs,
        rolledBackSendOperations,
        rolledBackMeltOperations,
        releasedOrphanedReservations,
        errors,
      };
    } finally {
      this.isFreeingReservedProofs = false;
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

    const repo = manager.proofRepository;
    const svc = manager.proofService;
    if (!repo?.getInflightProofs || !svc?.restoreProofsToReady) return 0;

    try {
      const inflight = await repo.getInflightProofs([mintUrl]);
      if (inflight.length === 0) return 0;

      const secrets = inflight.map((p) => p.secret);
      await svc.restoreProofsToReady(mintUrl, secrets);
      cashuLog.info('cashu.manager.proofs_restored', { count: secrets.length, mintUrl });
      return secrets.length;
    } catch (err) {
      cashuLog.warn('cashu.manager.proofs_restore_failed', { error: err });
      return 0;
    }
  }
}
