import { createCredentialStaging } from '@/shared/lib/cashu/credentialStaging';
import { registerAccountScoped } from '@/shared/lib/account/accountRegistry';
import { AppState, type AppStateStatus } from 'react-native';
import { Manager, type WebSocketFactory, type WebSocketLike } from '@cashu/coco-core';
import type { Plugin } from '@cashu/coco-core/plugin';
import {
  createCashuSeedGetter,
  deriveStandardCashuSeed,
  withTimeout,
  disposeCashuSeedGetter,
  disposeReusableQuoteFlights,
  resetMeltTarget,
} from 'wallet';
import { CocoCoreLogger } from './cocoLogger';
import {
  ExpoSqliteRepositories,
  type ExpoSqliteRepositoriesOptions,
} from '@cashu/coco-expo-sqlite';
import { createSovranCocoRepositories } from './cocoRepositories';
import {
  askForRestoreIfWalletDatabaseLost,
  recordWalletDatabaseCreated,
} from './walletDatabaseRecord';
import * as SQLite from 'expo-sqlite';
import {
  retrieveMnemonic,
  retrieveCashuSeed,
  storeCashuSeed,
  hashMnemonic,
} from '@/shared/lib/nostr/secureStorage';
import { NPCPlugin, type NPCAccountApi, type Signer as NpcSigner } from 'coco-cashu-plugin-npc';
import { createPaymentRequestNostrTransportPlugin } from '@/shared/lib/cashu/paymentRequestNostrTransport';
import { cashuP2pkPubkeyFromNostrHex } from '@/shared/lib/protocolIds';
import {
  NPC_BASE_URL,
  NPC_SYNC_INTERVAL_MS,
  AsyncStorageSinceStore,
  createNpcClient,
  getNpcSinceStoreKey,
  pauseNpcSync,
  resumeNpcSync,
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
import { checkStagedCredentials } from '@/shared/lib/nostr/accountIntegrity';
import { AccountIntegrityError } from '@/shared/lib/nostr/derivationIntegrity';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core';
import * as Sharing from 'expo-sharing';
import { cashuLog, initLog, initPhase, redactError, mintUrlLogFields } from '../logger';
import { withCallTiming } from '../loggerCallTiming';
import { resolveOutputDataCreator } from './outputDataCreator';
import { drainSqlite } from './drainSqlite';
import { TIMED_OUT, settleWithin } from '@/shared/lib/profile/settleWithin';
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
// key is extractable; only lock low-value, rotatable giveaways to it.
const GIVEAWAY_P2PK_SECRET: string | null =
  typeof Constants.expoConfig?.extra?.giveawayP2pkSecret === 'string' &&
  Constants.expoConfig.extra.giveawayP2pkSecret.length > 0
    ? Constants.expoConfig.extra.giveawayP2pkSecret
    : null;

/**
 * Ceiling on the npub.cash lock-state check that runs during plugin init.
 * Generous enough for a cold cellular round trip, short enough that a
 * blackholed host cannot hold up the funds-recovery steps behind it.
 */
const NPC_UNLOCK_CHECK_TIMEOUT_MS = 5_000;

/**
 * The Manager's public API objects. Calls through these (and the Manager's own
 * methods) are timed as `coco.call`; its private services are not listed, so
 * `managerInternals` reach-ins get the real objects.
 */
const COCO_TIMED_NAMESPACES = [
  'mint',
  'wallet',
  'keyring',
  'history',
  'auth',
  'ops',
  'quotes',
  'paymentRequests',
  'subscriptions',
  'ext',
] as const satisfies readonly (keyof Manager)[];

/**
 * Passed to the Manager's constructor as well as to the explicit enable call:
 * coco's `resumeSubscriptions` rebuilds the processor from its constructor
 * config, so both must describe the same processor.
 */
const MINT_OPERATION_PROCESSOR_OPTIONS = {
  processIntervalMs: 5000,
  maxRetries: 3,
  baseRetryDelayMs: 1000,
  initialEnqueueDelayMs: 2000,
};

/** How long a resume waits for the sockets the pause closed to report it. */
const SOCKET_CLOSE_WAIT_MS = 2_000;
const FOREGROUND_GATE_ATTEMPTS = 3;
const FOREGROUND_GATE_RETRY_MS = 2_000;
/**
 * How long the app must stay backgrounded before wallet polling is paused.
 * Android reports `background` for system dialogs, the biometric prompt and
 * the share sheet while the app is still on screen, and a user copying an
 * invoice into another app is back within seconds. Pausing for those would
 * close and reopen every mint socket for nothing.
 */
const BACKGROUND_PAUSE_GRACE_MS = 10_000;

interface ForegroundSignal {
  currentState: AppStateStatus;
  addEventListener(type: 'change', listener: (state: AppStateStatus) => void): { remove(): void };
}

/**
 * Keep background work paused while the app is backgrounded.
 *
 * Transitions run one at a time and the loop re-reads the wanted state after
 * each, so a quick background → foreground never overlaps a pause with a
 * resume and never runs either twice. `inactive` is ignored: the app is still
 * on screen. A failed transition is retried; after the last attempt the state
 * is taken as reached so the next transition (a resume, after a failed pause)
 * still runs.
 */
export function createForegroundGate(options: {
  appState: ForegroundSignal;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Stay backgrounded this long before pausing. Default 0: pause at once. */
  pauseAfterMs?: number;
}): { dispose: () => Promise<void> } {
  const pauseAfterMs = options.pauseAfterMs ?? 0;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  const clearGrace = () => {
    if (graceTimer) clearTimeout(graceTimer);
    graceTimer = null;
  };
  let wantPaused = options.appState.currentState === 'background';
  let paused = false;
  let disposed = false;
  let settling: Promise<void> | null = null;

  const settle = async (): Promise<void> => {
    let failures = 0;
    try {
      while (!disposed && paused !== wantPaused) {
        const next = wantPaused;
        try {
          await (next ? options.pause() : options.resume());
        } catch (error) {
          failures += 1;
          cashuLog.warn('cashu.manager.foreground_gate.failed', {
            pausing: next,
            failures,
            error: redactError(error),
          });
          if (failures < FOREGROUND_GATE_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, FOREGROUND_GATE_RETRY_MS));
            continue;
          }
        }
        failures = 0;
        paused = next;
      }
    } finally {
      settling = null;
    }
  };

  const request = (): void => {
    if (settling || disposed || paused === wantPaused) return;
    settling = settle();
  };

  const subscription = options.appState.addEventListener('change', (state) => {
    if (state === 'background') {
      if (pauseAfterMs > 0) {
        if (graceTimer || wantPaused) return;
        graceTimer = setTimeout(() => {
          graceTimer = null;
          wantPaused = true;
          request();
        }, pauseAfterMs);
        return;
      }
      wantPaused = true;
    } else if (state === 'active') {
      clearGrace();
      wantPaused = false;
    } else return;
    request();
  });
  request();

  return {
    async dispose() {
      disposed = true;
      clearGrace();
      subscription.remove();
      await settling;
    },
  };
}

/**
 * Wrap a WebSocket factory so a caller can wait for sockets to report closed.
 *
 * coco's connection manager handles `close` without checking which socket
 * closed: a close that arrives after a replacement was opened drops the
 * replacement and its queued subscriptions, leaving that mint on HTTP polling.
 * Closing is asynchronous on React Native, so a resume straight after a pause
 * can open the replacements first. Waiting here keeps the two in order.
 */
export function trackSocketCloses(create: WebSocketFactory): {
  factory: WebSocketFactory;
  open: () => WebSocketLike[];
  closed: (sockets: readonly WebSocketLike[], timeoutMs: number) => Promise<boolean>;
} {
  const open = new Set<WebSocketLike>();
  const waiters = new Set<() => void>();
  return {
    factory(url) {
      const socket = create(url);
      open.add(socket);
      socket.addEventListener('close', () => {
        open.delete(socket);
        for (const waiter of [...waiters]) waiter();
      });
      return socket;
    },
    open: () => [...open],
    closed(sockets, timeoutMs) {
      const pending = () => sockets.some((socket) => open.has(socket));
      if (!pending()) return Promise.resolve(true);
      return new Promise((resolve) => {
        const finish = (settled: boolean) => {
          clearTimeout(timer);
          waiters.delete(check);
          // A socket that never reports is not waited for again.
          for (const socket of sockets) open.delete(socket);
          // Next task: coco's own `close` listeners run after this one.
          setTimeout(() => resolve(settled), 0);
        };
        const check = () => {
          if (!pending()) finish(true);
        };
        const timer = setTimeout(() => finish(false), timeoutMs);
        waiters.add(check);
      });
    },
  };
}

/**
 * Pause coco's subscriptions and NPC sync while the app is backgrounded, and
 * bring both back with an immediate check when it returns.
 *
 * Pausing stops NPC first: a sync that lands after coco has stopped its mint
 * processor would queue quotes nothing is listening for. Resuming goes through
 * coco's own `resumeSubscriptions`, which reconnects the mint sockets, restarts
 * every watcher with a rescan of what is pending and recovers pending mint
 * operations: the checks a cold start makes, so anything paid while
 * backgrounded is found on return. NPC restarts after it, once the processor
 * is listening again.
 */
export function createWalletForegroundGate(options: {
  appState: ForegroundSignal;
  manager: Pick<Manager, 'pauseSubscriptions' | 'resumeSubscriptions' | 'requeuePaidMintQuotes'>;
  npcAccount: () => NPCAccountApi | null;
  socketCloses: ReturnType<typeof trackSocketCloses> | null;
  pauseAfterMs?: number;
}): { dispose: () => Promise<void> } {
  const { manager, socketCloses } = options;
  /** Mint sockets the last pause closed that had not yet reported it. */
  let closingSockets: WebSocketLike[] = [];

  return createForegroundGate({
    appState: options.appState,
    pauseAfterMs: options.pauseAfterMs,
    async pause() {
      cashuLog.info('cashu.manager.background_pause.start');
      const npcAccount = options.npcAccount();
      if (npcAccount) await pauseNpcSync(npcAccount);
      await manager.pauseSubscriptions();
      closingSockets = socketCloses?.open() ?? [];
      cashuLog.info('cashu.manager.background_pause.done', {
        closingSockets: closingSockets.length,
      });
    },
    async resume() {
      const t0 = performance.now();
      const socketsClosed =
        (await socketCloses?.closed(closingSockets, SOCKET_CLOSE_WAIT_MS)) ?? true;
      closingSockets = [];
      await manager.resumeSubscriptions();
      const npcAccount = options.npcAccount();
      if (npcAccount) {
        void resumeNpcSync(npcAccount).catch((error) =>
          cashuLog.warn('cashu.manager.npc_sync_failed', { error })
        );
      }
      try {
        await manager.requeuePaidMintQuotes();
      } catch (error) {
        cashuLog.warn('cashu.manager.paid_mint_quote_requeue_failed', { error });
      }
      cashuLog.info('cashu.manager.foreground_resume.done', {
        socketsClosed,
        duration_ms: Math.round((performance.now() - t0) * 100) / 100,
      });
    },
  });
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

/** How long delete-all waits for a wallet that is still opening. */
const RESET_INIT_WAIT_MS = 10_000;

/**
 * How long a teardown waits for background start-up to end before going on
 * without it. Shorter than the five seconds an in-process account switch
 * allows each of its steps (`STEP_TIMEOUT_MS` in `inProcessProfileSwitch.ts`),
 * so a slow start-up costs the switch a wait and not a restart.
 */
const BACKGROUND_DRAIN_MS = 3_000;

/** A wallet whose plugins have started, and the database it runs on. */
interface OpenWallet {
  instance: Manager;
  db: SQLite.SQLiteDatabase;
}

/**
 * Where the wallet is in its life, and what each state owns. An open owns the
 * database it has opened so far (`acquired`), so whatever way it fails it
 * closes it; a ready wallet owns its manager and database; a close owns the
 * wallet it tears down (`holding`) until it has closed it. Every caller of
 * `initialize` joins the one open, and everyone who asks during a close waits
 * for it. Not saved anywhere.
 */
type WalletLife =
  | { phase: 'closed' }
  | {
      phase: 'opening';
      opened: Promise<OpenWallet>;
      acquired: { db: SQLite.SQLiteDatabase | null };
    }
  | ({ phase: 'ready' } & OpenWallet)
  | {
      phase: 'closing';
      /** Whether the teardown was complete. */
      closed: Promise<boolean>;
      holding: { wallet: OpenWallet | null };
    };

/**
 * Coco Manager singleton for managing Cashu operations
 */
export class CocoManager {
  private static life: WalletLife = { phase: 'closed' };

  /**
   * The wallet callers may use: the ready one, or the one a close is still
   * tearing down (its background work is let finish on it). None while an
   * open has not finished starting its plugins.
   */
  private static openWallet(): Manager | null {
    const life = this.life;
    switch (life.phase) {
      case 'ready':
        return life.instance;
      case 'closing':
        return life.holding.wallet?.instance ?? null;
      case 'opening':
      case 'closed':
        return null;
      default: {
        const unreachable: never = life;
        return unreachable;
      }
    }
  }

  /**
   * Background start-up still running. It works on the wallet and the identity
   * it was started for, so a teardown waits for it before taking either away.
   * "Is anything running" is whether this is empty: one flag shared by every
   * start would be cleared by an abandoned start finishing while a newer one
   * was still going.
   */
  private static pendingBackground = new Set<{ wallet: Manager | null; settled: Promise<void> }>();
  /** Background start-up still running for this wallet. */
  private static backgroundOf(wallet: Manager | null): Promise<void>[] {
    return [...this.pendingBackground]
      .filter((entry) => entry.wallet === wallet)
      .map((entry) => entry.settled);
  }
  private static npcPlugin: NPCPlugin | null = null;
  private static npcAccount: NPCAccountApi | null = null;
  private static npcPluginRegistered = false;
  /** Pauses coco and NPC polling while the app is backgrounded. Armed only
   *  once enableNpcSyncAndProcessor has run; see armForegroundGate. */
  private static foregroundGate: ReturnType<typeof createForegroundGate> | null = null;
  private static socketCloses: ReturnType<typeof trackSocketCloses> | null = null;
  /** Stored reference to seed getter for pre-warming during background init */
  private static seedGetter: (() => Promise<Uint8Array>) | null = null;

  /** Zero and drop the current session's memoized Cashu seed, if one exists. */
  static disposeSeed(): void {
    if (this.seedGetter) disposeCashuSeedGetter(this.seedGetter);
  }
  /**
   * The account, wallet phrase and signer key the next wallet opens with, and
   * the rule for clearing them when a wallet closes. See `credentialStaging.ts`.
   */
  private static credentials = createCredentialStaging();
  /** Which database file, and which derivation index, the staged account uses. */
  private static get accountIndex(): number {
    return this.credentials.accountIndex;
  }

  /**
   * Bumped by `completeReset`. An initialise notes it at its start and, if a
   * reset has happened by the time it has a database or a manager in hand,
   * closes what it opened instead of publishing it: a wallet must not come
   * back to life after delete-all.
   */
  private static resetGeneration = 0;

  /**
   * Forget what belonged to the wallet that just closed: its plugins, its seed
   * getter, and its staged credentials. With `since`, a credential staged
   * again after that snapshot is left for the wallet that will open next.
   */
  private static clearSensitiveRuntimeState(
    since?: ReturnType<typeof CocoManager.credentials.revisions>
  ): void {
    this.credentials.clearUnchangedSince(since);
    this.npcPlugin = null;
    this.npcAccount = null;
    this.npcPluginRegistered = false;
    this.seedGetter = null;
  }

  /**
   * Set the account index for per-profile database isolation.
   * Must be called before initialize().
   * Account 0 uses 'coco.db' (backward compatible), N>0 uses 'coco-N.db'.
   */
  static setAccountIndex(index: number, imported = false): void {
    this.credentials.stageAccount(index, imported);
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

  /**
   * The same name, for an account that is not the staged one. `getDbName`
   * stays spelled out: `releasedPersistedSurface.test.ts` pins its text.
   */
  private static dbNameFor(accountIndex: number): string {
    return accountIndex === 0 ? 'coco.db' : `coco-${accountIndex}.db`;
  }

  /**
   * The wallet databases that have any file in the SQLite directory: the
   * database itself, a journal beside it, or a pre-v2 backup of it.
   */
  private static async walletDatabasesOnDisk(): Promise<string[]> {
    const directory = `${FileSystem.documentDirectory}SQLite/`;
    // No directory yet means no databases. A directory that is there and
    // cannot be listed is different: what it holds is unknown, and a wipe that
    // went on would report success over databases it never saw.
    if (!(await FileSystem.getInfoAsync(directory)).exists) return [];
    const files = await FileSystem.readDirectoryAsync(directory);
    const names = new Set<string>();
    for (const file of files) {
      const name = /^(coco(?:-\d+)?\.db)(?:$|[-.])/.exec(file)?.[1];
      if (name) names.add(name);
    }
    return [...names];
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
   * live DB handle (reopened when the backup had to close it), the pre-init
   * migration count (-1 when unknown), and whether the database held no
   * tables: the file was missing and SQLite has just created it.
   */
  private static async runPreInitSafetyRails(
    db: SQLite.SQLiteDatabase,
    dbName: string
  ): Promise<{
    db: SQLite.SQLiteDatabase;
    migrationCount: number;
    migrationExpected: boolean;
    wasEmpty: boolean;
  }> {
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
        return { db, migrationCount, migrationExpected, wasEmpty: tables.length === 0 };
      }

      const balances = await this.snapshotReadyProofBalances(db, tables).catch(() => null);
      cashuLog.info('cashu.manager.balance_snapshot.pre_migration', { dbName, balances });
      await this.scanNonCanonicalAmounts(db, dbName, tables).catch(() => undefined);

      const { dbPath, sidecars, backupPath, backupSidecars } = this.getDbPaths(dbName);
      const existing = await FileSystem.getInfoAsync(backupPath);
      if (existing.exists) {
        cashuLog.info('cashu.manager.db_backup.skipped', { dbName, reason: 'backup_exists' });
        return { db, migrationCount, migrationExpected: true, wasEmpty: false };
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
      return { db: reopened, migrationCount, migrationExpected: true, wasEmpty: false };
    } catch (error) {
      cashuLog.error('cashu.manager.db_backup.failed', { dbName, error });
      // The handle may have been closed mid-backup; make sure init still gets a live one.
      try {
        await db.getFirstAsync('SELECT 1');
        return { db, migrationCount: -1, migrationExpected: true, wasEmpty: false };
      } catch {
        return {
          db: await SQLite.openDatabaseAsync(dbName),
          migrationCount: -1,
          migrationExpected: true,
          wasEmpty: false,
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
    this.credentials.stageWalletPhrase(mnemonic);
    cashuLog.debug('cashu.manager.cashu_mnemonic_set', {
      hasMnemonic: mnemonic.length > 0,
    });
  }

  /**
   * Set the Nostr private key so getCurrentProfileSigner() can skip derivation.
   * Called from CocoProvider with the key already derived by NostrKeysProvider.
   */
  static setSignerKey(sk: Uint8Array): void {
    this.credentials.stageSigner(sk);
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
    for (;;) {
      const life = this.life;
      switch (life.phase) {
        case 'closing':
          // A close still running (e.g. fire-and-forget from CocoProvider
          // unmount during hot reload) ends before the next open starts.
          initLog('CocoManager', 'cleanup in progress, waiting before initialize...');
          cashuLog.info('cashu.manager.initialize.wait_cleanup', {
            accountIndex: this.accountIndex,
            dbName: this.getDbName(),
          });
          await life.closed;
          continue;
        case 'ready':
          initLog('CocoManager', 'already initialized, returning existing instance');
          cashuLog.debug('cashu.manager.initialize.reuse', {
            accountIndex: this.accountIndex,
            dbName: this.getDbName(),
          });
          return life.instance;
        case 'opening':
          initLog('CocoManager', 'initialization in progress, awaiting in-flight promise');
          cashuLog.info('cashu.manager.initialize.join_pending', {
            accountIndex: this.accountIndex,
            dbName: this.getDbName(),
          });
          return (await life.opened).instance;
        case 'closed': {
          // The open is published as ready, or as closed again when it fails,
          // only while it is still the manager's state: a close that took
          // over waits for it and tears down what it returns, and a reset
          // has already let it go.
          const acquired: { db: SQLite.SQLiteDatabase | null } = { db: null };
          const opened = this.open(acquired).then(
            (wallet) => {
              if (this.life === opening) this.life = { phase: 'ready', ...wallet };
              return wallet;
            },
            (error: unknown) => {
              if (this.life === opening) this.life = { phase: 'closed' };
              throw error;
            }
          );
          const opening: WalletLife = { phase: 'opening', opened, acquired };
          this.life = opening;
          return (await opened).instance;
        }
        default: {
          const unreachable: never = life;
          return unreachable;
        }
      }
    }
  }

  /**
   * Opens the staged account's wallet. The database goes into `acquired` as
   * soon as it is open, where a reset can reach it, and an open that fails
   * closes it.
   */
  private static async open(acquired: { db: SQLite.SQLiteDatabase | null }): Promise<OpenWallet> {
    const initStart = performance.now();
    const closeAcquired = async () => {
      const db = acquired.db;
      acquired.db = null;
      await db?.closeAsync().catch(() => undefined);
    };
    try {
      // The whole identity is read here, before the first await. The database
      // name is fixed on the next line; reading the phrase or the imported
      // flag after the awaits below would let a credential staged for the
      // next account be paired with this account's database.
      const {
        signerKey: p2pkImportSecretKey,
        accountIndex,
        isImported,
        cashuMnemonic,
      } = this.credentials.capture();
      const resetGeneration = this.resetGeneration;

      // 1. SQLite database (async to avoid blocking JS thread during profile switch)
      const dbName = this.getDbName();
      // The account, the imported flag and the signer key must be the saved
      // row's before its database is opened under them. This is a fault in
      // what was staged, not in what is stored (the key loader has already
      // checked that), so the open fails and nothing else is raised.
      const staged = checkStagedCredentials({
        accountIndex,
        isImported,
        signerKey: p2pkImportSecretKey,
      });
      if (staged && !staged.ok) {
        cashuLog.error('cashu.manager.staged_credentials_mismatch', {
          accountIndex,
          code: staged.diagnosticCode,
        });
        throw new AccountIntegrityError(staged);
      }
      cashuLog.info('cashu.manager.initialize.start', {
        accountIndex: this.accountIndex,
        dbName,
        importedProfile: isImported,
        hasCashuMnemonic: !!cashuMnemonic,
        hasSignerKey: !!p2pkImportSecretKey,
        hasGiveawayP2PK: !!GIVEAWAY_P2PK_SECRET,
      });
      logCocoVersions();
      const opened = await initPhase(`CocoManager.openDB[${dbName}]`, () =>
        SQLite.openDatabaseAsync(dbName)
      );
      cashuLog.debug('cashu.manager.sqlite_opened', { dbName });
      const {
        db: openedDb,
        migrationCount: preInitMigrationCount,
        migrationExpected,
        wasEmpty,
      } = await initPhase('CocoManager.preInitSafetyRails', () =>
        this.runPreInitSafetyRails(opened, dbName)
      );
      const db = drainSqlite(openedDb);
      if (resetGeneration !== this.resetGeneration) {
        await this.discardAfterReset(db, dbName);
        throw new Error('Wallet was reset while it was opening');
      }
      acquired.db = db;
      const database = db as unknown as ExpoSqliteRepositoriesOptions['database'];
      // The profile's signer key is imported into coco's keyring (p2pk-import
      // plugin below) so P2PK receives auto-sign — but it must never reach
      // coco's plaintext SQLite keyring table. The overlay keeps it
      // in-memory for this manager session and scrubs legacy rows.
      const ephemeralKeyringPubkeys = new Set<string>();
      if (p2pkImportSecretKey) {
        ephemeralKeyringPubkeys.add(
          cashuP2pkPubkeyFromNostrHex(getPublicKey(new Uint8Array(p2pkImportSecretKey)))
        );
      }
      cashuLog.info('cashu.manager.repositories.create', {
        dbName,
        ephemeralKeyringCount: ephemeralKeyringPubkeys.size,
      });
      const repositories = createSovranCocoRepositories(new ExpoSqliteRepositories({ database }), {
        ephemeralKeyringPubkeys,
      });
      // Decided here, while the database is still empty: once the migrations
      // below have run, a wallet that was lost looks like any other.
      askForRestoreIfWalletDatabaseLost(accountIndex, wasEmpty);
      await initPhase('CocoManager.reposInit', () => repositories.init());
      cashuLog.debug('cashu.manager.repositories.ready', { dbName });
      // Post-init dump is diagnostic for migration boots only — skip the
      // extra sqlite_master scan on ordinary already-migrated boots.
      if (migrationExpected) {
        await this.logPostInitSchema(db, dbName, preInitMigrationCount);
      }

      // 2. Seed getter (lazy — no crypto work until first call, cached after)
      // Tries SecureStore seed cache first (~5ms) before falling back to PBKDF2 (~5s).
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
      // Resolve the release-gated backend once for the manager lifetime.
      const outputDataCreator = resolveOutputDataCreator();

      // The timing proxy IS the instance from here on: every hand-out
      // (initialize, getInstance, peekInstance) returns this one object, so
      // callers that key a WeakMap by the manager or compare it with `!==`
      // across a profile switch see a single stable identity.
      // Outside e2e mint-fault sessions this is the socket coco would open
      // itself (its fallback is the global WebSocket); it is only wrapped
      // so a resume can wait for the sockets a pause closed.
      const createSocket: WebSocketFactory | undefined =
        maybeCreateMintFaultWebSocketFactory() ??
        (typeof globalThis.WebSocket === 'undefined'
          ? undefined
          : (url) => new globalThis.WebSocket(url));
      this.socketCloses = createSocket ? trackSocketCloses(createSocket) : null;

      const manager = new Manager(
        repositories,
        seedGetter,
        new CocoCoreLogger('manager'),
        this.socketCloses?.factory,
        plugins,
        // The constructor starts nothing; watchers and processors are
        // enabled explicitly in the two phases below. The watchers'
        // defaults match what those calls pass, and the subscription
        // intervals stay coco's (20s beside a websocket, 5s without one).
        undefined,
        { mintOperationProcessor: MINT_OPERATION_PROCESSOR_OPTIONS },
        undefined,
        outputDataCreator
      );
      if (resetGeneration !== this.resetGeneration) {
        await manager.dispose().catch(() => undefined);
        acquired.db = null;
        await this.discardAfterReset(db, dbName);
        throw new Error('Wallet was reset while it was opening');
      }
      // After the reset check: delete-all has just forgotten these accounts.
      // The other accounts are checked off the startup path, not waited for.
      recordWalletDatabaseCreated(accountIndex);
      // Opt-in with EXPO_PUBLIC_PERF_PROBES=1. An entry per coco call is
      // thousands a minute, which slows a dev build enough to matter.
      const wallet =
        process.env.EXPO_PUBLIC_PERF_PROBES === '1'
          ? withCallTiming(manager, {
              event: 'coco.call',
              logger: cashuLog,
              namespaces: COCO_TIMED_NAMESPACES,
            })
          : manager;
      // The wallet is handed out only once its plugins have started. One
      // whose plugins failed is closed here, so the next open starts afresh
      // instead of being handed it.
      try {
        await initPhase('CocoManager.initCorePlugins', () => wallet.initPlugins());
      } catch (error) {
        await manager.dispose().catch(() => undefined);
        throw error;
      }
      if (resetGeneration !== this.resetGeneration) {
        await manager.dispose().catch(() => undefined);
        acquired.db = null;
        await this.discardAfterReset(db, dbName);
        throw new Error('Wallet was reset while it was opening');
      }
      // The ready wallet owns the database from here.
      acquired.db = null;
      initLog('CocoManager', 'Manager created');
      cashuLog.info('cashu.manager.initialized', {
        duration_ms: Math.round((performance.now() - initStart) * 100) / 100,
        accountIndex,
        dbName,
      });

      return { instance: wallet, db };
    } catch (error) {
      await closeAcquired();
      cashuLog.error('cashu.manager.init_failed', { error });
      // Manager/repositories init failing is exactly what upstream needs
      // to hear about (schema migration or adapter contract breakage).
      reportCocoApiFailure('Manager.initialize/repositories.init', error, {
        dbName: this.getDbName(),
      });
      throw error;
    }
  }

  /**
   * Enable observe-only watchers and pre-warm the seed cache. Safe to call
   * before NUT-13 wallet restore has completed — does not start any operation
   * that uses the deterministic counter.
   */
  static enableSafeWatchers(): Promise<void> {
    return this.runBackground(() => this.startSafeWatchers());
  }

  /** Run a background start so that `cleanup` can wait for it to end. */
  private static runBackground(start: () => Promise<void>): Promise<void> {
    // Filed under the wallet it was started for. Work left behind by a
    // teardown that stopped waiting belongs to a wallet that is gone: it must
    // not make the next wallet look busy for as long as it takes to end.
    const wallet = this.openWallet();
    const work = start();
    const entry = {
      wallet,
      settled: work.then(
        () => undefined,
        () => undefined
      ),
    };
    this.pendingBackground.add(entry);
    void entry.settled.then(() => this.pendingBackground.delete(entry));
    return work;
  }

  private static async startSafeWatchers(): Promise<void> {
    // The wallet this start is for. Every step below acts on it and on nothing
    // read later from the statics: by the time an await returns, a teardown
    // that stopped waiting may have opened the next account's wallet.
    const manager = this.openWallet();
    if (!manager) {
      cashuLog.warn('cashu.manager.safe_watchers.no_instance');
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    const superseded = () => {
      if (this.openWallet() === manager) return false;
      cashuLog.warn('cashu.manager.safe_watchers.superseded');
      return true;
    };
    const t0 = performance.now();
    cashuLog.info('cashu.manager.safe_watchers.start');

    if (this.seedGetter) {
      await initPhase('CocoManager.seedCacheWarm', () => this.seedGetter!());
    } else {
      cashuLog.warn('cashu.manager.seed_cache_warm.skipped', { reason: 'missing_seed_getter' });
    }
    if (superseded()) return;

    try {
      await initPhase('CocoManager.enableProofWatcher', () => manager.enableProofStateWatcher());
    } catch (error) {
      cashuLog.warn('cashu.manager.proof_watcher_failed', { error });
      try {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (superseded()) return;
        await manager.enableProofStateWatcher();
        initLog('CocoManager', 'proof state watcher enabled on retry');
        cashuLog.info('cashu.manager.proof_watcher_retry_done');
      } catch (retryError) {
        cashuLog.error('cashu.manager.proof_watcher_retry_failed', { error: retryError });
        reportCocoApiFailure('enableProofStateWatcher', retryError);
      }
    }

    const e2eFundedAssets = process.env.EXPO_PUBLIC_E2E_FUNDED_ASSETS;
    if (
      !superseded() &&
      __DEV__ &&
      process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_ENDPOINT &&
      process.env.EXPO_PUBLIC_E2E_SEED_EXPORT_TOKEN &&
      e2eFundedAssets
    ) {
      try {
        const result = await initPhase('CocoManager.e2eReadyProofReconcile', () =>
          reconcileE2EReadyProofs(manager, e2eFundedAssets)
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
  }

  /**
   * Start the mint-operation watcher (with `watchExistingPendingOnStart`),
   * the mint-operation processor, and NPC sync. **Must NOT be called until the wallet
   * has restored its NUT-13 deterministic counter from the mint** — otherwise
   * any minting from a paid quote will use a counter the mint already signed,
   * triggering an `outputs already signed` rejection that retries forever
   * (see walletLifecycleStore + AppGate's RestoreGate).
   */
  static enableNpcSyncAndProcessor(): Promise<void> {
    return this.runBackground(() => this.startNpcSyncAndProcessor());
  }

  private static async startNpcSyncAndProcessor(): Promise<void> {
    const manager = this.openWallet();
    if (!manager) {
      cashuLog.warn('cashu.manager.npc_sync_and_processor.no_instance');
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    const t0 = performance.now();
    cashuLog.info('cashu.manager.npc_sync_and_processor.start');

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
      npcAccount = await this.getOrCreateNpcAccount(manager);
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
      await manager.enableMintOperationProcessor(MINT_OPERATION_PROCESSOR_OPTIONS);
      initLog('CocoManager', 'mint quote processor enabled');
      cashuLog.info('cashu.manager.quote_processor_enabled', {
        processIntervalMs: MINT_OPERATION_PROCESSOR_OPTIONS.processIntervalMs,
        maxRetries: MINT_OPERATION_PROCESSOR_OPTIONS.maxRetries,
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

    // The gate is the manager's own, one at a time: a start that was left
    // behind by a teardown must not arm it for a wallet that is gone.
    if (this.openWallet() === manager) this.armForegroundGate(manager);

    cashuLog.info('cashu.manager.npc_sync_and_processor.done', {
      duration_ms: Math.round((performance.now() - t0) * 100) / 100,
    });
  }

  /**
   * Start pausing wallet polling while the app is backgrounded.
   *
   * Armed here and not at initialize() because coco's `resumeSubscriptions`
   * turns every watcher and processor back on, including the mint-operation
   * pair that must stay off until the NUT-13 restore has finished. Once
   * enableNpcSyncAndProcessor has run they are all meant to be on, so a resume
   * can only restore what was already enabled. Before that point backgrounding
   * pauses nothing, as it always has.
   */
  private static armForegroundGate(manager: Manager): void {
    if (this.foregroundGate || this.openWallet() !== manager) return;
    this.foregroundGate = createWalletForegroundGate({
      appState: AppState,
      manager,
      npcAccount: () => this.npcAccount,
      socketCloses: this.socketCloses,
      pauseAfterMs: BACKGROUND_PAUSE_GRACE_MS,
    });
  }

  /** Stop following the foreground and wait out a transition in flight, so
   *  teardown never runs beside a pause or a resume. */
  private static async disarmForegroundGate(): Promise<void> {
    const gate = this.foregroundGate;
    this.foregroundGate = null;
    this.socketCloses = null;
    await gate?.dispose();
  }

  /**
   * Get the initialized Manager instance
   * Throws if not initialized
   */
  static getInstance(): Manager {
    const wallet = this.openWallet();
    if (!wallet) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
    return wallet;
  }

  /**
   * Non-throwing instance peek. Used by lifecycle code (e.g. CocoProvider's
   * phase-2 background chain) to assert the manager it captured is still the
   * live instance before acting on the statics — a chain orphaned by a
   * profile-switch remount must not arm watchers/sync on the NEW profile's
   * manager (BTC-13).
   */
  static peekInstance(): Manager | null {
    return this.openWallet();
  }

  /**
   * Whether a wallet is open: its plugins have started and no close has torn
   * it down yet.
   */
  static isInitialized(): boolean {
    return this.openWallet() !== null;
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
    const wallet = this.openWallet();
    const parts = {
      hasInstance: wallet !== null,
      initInFlight: this.life.phase === 'opening',
      cleanupInFlight: this.life.phase === 'closing',
      backgroundRunning: this.backgroundOf(wallet).length > 0,
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
   * Closes the wallet: lets its background start-up end, tears it down and
   * closes its database. Everyone who asks while a close runs joins it, and an
   * open that asks waits for it (e.g. a new CocoProvider mounting during hot
   * reload must not race the teardown). With `requireSuccess`, a teardown that
   * was not complete rejects.
   */
  static async cleanup(options?: { requireSuccess: boolean }): Promise<void> {
    const life = this.life;
    let complete: boolean;
    if (life.phase === 'closing') {
      cashuLog.info('cashu.manager.cleanup_join_pending');
      complete = await life.closed;
    } else {
      const holding = {
        wallet: life.phase === 'ready' ? { instance: life.instance, db: life.db } : null,
      };
      const closing: Extract<WalletLife, { phase: 'closing' }> = {
        phase: 'closing',
        closed: this.close(life, holding),
        holding,
      };
      this.life = closing;
      try {
        complete = await closing.closed;
      } finally {
        // A teardown that threw before it reached the wallet leaves it open.
        if (this.life === closing) {
          this.life = holding.wallet ? { phase: 'ready', ...holding.wallet } : { phase: 'closed' };
        }
      }
    }
    if (options?.requireSuccess && !complete) throw new Error('Coco teardown incomplete');
  }

  /** The teardown behind `cleanup`; resolves whether it was complete. */
  private static async close(
    from: Exclude<WalletLife, { phase: 'closing' }>,
    holding: { wallet: OpenWallet | null }
  ): Promise<boolean> {
    const stagedAtStart = this.credentials.revisions();
    // An open still in flight finishes with a wallet that is this close's to
    // tear down. Returning now would report a closed wallet while one is still
    // being opened, for the account that was current when it started, and
    // would clear the keys it is reading.
    if (from.phase === 'opening') {
      cashuLog.info('cashu.manager.cleanup_wait_init');
      holding.wallet = await from.opened.catch(() => null);
    }
    // Background start-up that began just before this teardown (an account
    // switch checks readiness and then waits for its disk guard) is still
    // using this wallet and the identity it started with. Let it end first,
    // so none of it runs on into the next account. It is bounded: work that
    // has not ended by then is no longer waited for, and what it does next
    // is refused where it would read the active account
    // (`getOrCreateNpcAccount`).
    const running = this.backgroundOf(holding.wallet?.instance ?? null);
    if (running.length > 0) {
      cashuLog.info('cashu.manager.cleanup_wait_background');
      const drained = await settleWithin(Promise.all(running), BACKGROUND_DRAIN_MS);
      if (drained === TIMED_OUT) cashuLog.warn('cashu.manager.cleanup_background_not_drained');
    }
    await this.disarmForegroundGate();
    const wallet = holding.wallet;
    if (!wallet) {
      this.clearSensitiveRuntimeState(stagedAtStart);
      cashuLog.debug('cashu.manager.cleanup_skipped', { reason: 'no_instance' });
      return true;
    }

    cashuLog.info('cashu.manager.cleanup_start');
    const { instance, db } = wallet;
    let complete = true;
    // Disable watchers in reverse order to prevent conflicts. Kept as an
    // explicit sequence (not disableWatchers()) — this path disables the
    // quote processor before its watcher, the reverse of that method.
    const step = async (okEvent: string, failEvent: string, run: () => Promise<void>) => {
      if (!(await this.teardownStep(okEvent, failEvent, run))) complete = false;
    };
    await step(
      'cashu.manager.proof_watcher_disabled',
      'cashu.manager.proof_watcher_disable_failed',
      () => instance.disableProofStateWatcher()
    );
    await step(
      'cashu.manager.quote_processor_disabled',
      'cashu.manager.quote_processor_disable_failed',
      () => instance.disableMintOperationProcessor()
    );
    await step(
      'cashu.manager.quote_watcher_disabled',
      'cashu.manager.quote_watcher_disable_failed',
      () => instance.disableMintOperationWatcher()
    );
    await step(
      'cashu.manager.melt_watchers_disabled',
      'cashu.manager.melt_watchers_disable_failed',
      async () => {
        await instance.disableMeltSettlementProcessor();
        await instance.disableMeltQuoteWatcher();
      }
    );
    await step('cashu.manager.disposed', 'cashu.manager.dispose_failed', () => instance.dispose());

    // Close the SQLite connection to prevent "database is locked" on revisit
    try {
      await db.closeAsync();
      cashuLog.debug('cashu.manager.sqlite_closed');
    } catch (error) {
      complete = false;
      // Restart callers retain their best-effort behavior; an in-process switch refuses.
      cashuLog.debug('cashu.manager.sqlite_close_skipped', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Let go of the wallet even when the teardown was incomplete: handing out
    // a disposed manager makes every coco call throw "Cannot … after disposal
    // has started".
    holding.wallet = null;
    this.clearSensitiveRuntimeState(stagedAtStart);
    cashuLog.info('cashu.manager.cleanup_done');
    return complete;
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

  /**
   * `manager` is the wallet this account is for. The signer and the pubkey are
   * read from whichever account is active, after awaits: if the wallet has
   * been closed or replaced meanwhile they may be the next account's, and
   * nothing is created.
   */
  private static async getOrCreateNpcAccount(manager: Manager): Promise<NPCAccountApi | null> {
    const walletChanged = () => {
      if (this.openWallet() === manager) return false;
      cashuLog.warn('cashu.manager.npc_account_skipped_wallet_changed');
      return true;
    };
    // The saved account is the open wallet's. A start left behind by a
    // teardown is handed neither it nor a new one.
    if (walletChanged()) return null;
    if (this.npcAccount) return this.npcAccount;
    const npcPlugin = this.npcPlugin;
    if (!npcPlugin) return null;

    const nsecSigner = await initPhase('CocoManager.getSigner', () =>
      this.getCurrentProfileSigner()
    );
    initLog('CocoManager', `signer created: ${!!nsecSigner}`);

    if (!nsecSigner || walletChanged()) return null;

    // NpcSigner is `(t: EventTemplate) => Promise<SignedEvent>` from
    // npubcash-sdk; the underlying NsecSigner.signEvent is the same shape
    // via nostr-tools, so we re-type the param at the boundary.
    const signerFunction: NpcSigner = (eventTemplate) =>
      nsecSigner.signEvent(eventTemplate as EventTemplate);

    // Resolve the active profile's pubkey so the sync cursor is pubkey-keyed
    // (not accountIndex-keyed); guards against index recycling when the
    // highest-numbered profile is deleted.
    const activePubkey = (await import('@/shared/stores/global/profileStore')).activePubkey();

    if (!activePubkey) {
      cashuLog.warn('cashu.manager.npc_skip_no_pubkey');
      return null;
    }
    if (walletChanged()) return null;

    const account = await npcPlugin.addAccount({
      id: activePubkey,
      signer: signerFunction,
      baseUrl: NPC_BASE_URL,
      sinceStore: new AsyncStorageSinceStore(getNpcSinceStoreKey(activePubkey)),
      // autoStart arms the interval timer + websocket for this account.
      autoStart: true,
    });
    // Not saved over the next wallet's account if the wallet changed while it
    // was being added.
    if (walletChanged()) return null;
    this.npcAccount = account;
    initLog('CocoManager', 'NPC account added');
    await this.ensureNpcQuotesUnlocked(account, signerFunction);
    return account;
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
      // Bounded. `catch` handles rejection, not latency, and this is the only
      // network call between plugin init and every funds-recovery step that
      // follows (reconcileLegacyMintQuotes, the mint-operation watcher,
      // requeuePaidMintQuotes, the send/melt/receive recovery runs). The SDK
      // uses a bare fetch with no AbortSignal, and React Native sets OkHttp to
      // no timeout at all on Android, so a blackholed npub.cash host would
      // otherwise never settle — leaving background work counted as running, which
      // getCleanupReadiness() uses to refuse profile switches.
      const info = await withTimeout(account.getInfo(), NPC_UNLOCK_CHECK_TIMEOUT_MS, 'npc.getInfo');
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
      const signerKey = this.credentials.signerKey;
      if (signerKey) {
        initLog('CocoManager', 'using pre-set signerKey (fast path)');
        return new NsecSigner(signerKey);
      }

      if (this.credentials.isImported) {
        initLog('CocoManager', 'signerKey not set — loading imported nsec (slow path)');
        const { useProfileStore } = await import('@/shared/stores/global/profileStore');
        const activeProfile = useProfileStore.getState().getActiveProfile();
        if (!activeProfile) {
          cashuLog.warn('cashu.manager.no_active_profile');
          return null;
        }
        const { retrieveImportedNsec } = await import('@/shared/lib/nostr/secureStorage');
        const nip19 = await import('nostr-tools/nip19');
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
   * Run one teardown step, logging success/failure — teardown must never
   * throw past a single step. Event names are passed as literals (not
   * derived) so log-taxonomy greps keep finding them in source.
   */
  private static async teardownStep(
    okEvent: string,
    failEvent: string,
    run: () => Promise<void>
  ): Promise<boolean> {
    try {
      await run();
      cashuLog.debug(okEvent);
      return true;
    } catch (error) {
      cashuLog.warn(failEvent, { error });
      return false;
    }
  }

  /** Safely disable all watchers before tearing down the Manager. */
  private static async disableWatchers(instance: Manager): Promise<void> {
    await this.teardownStep(
      'cashu.manager.proof_watcher_disabled',
      'cashu.manager.proof_watcher_disable_failed',
      () => instance.disableProofStateWatcher()
    );
    await this.teardownStep(
      'cashu.manager.quote_watcher_disabled',
      'cashu.manager.quote_watcher_disable_failed',
      () => instance.disableMintOperationWatcher()
    );
    await this.teardownStep(
      'cashu.manager.quote_processor_disabled',
      'cashu.manager.quote_processor_disable_failed',
      () => instance.disableMintOperationProcessor()
    );
    await this.teardownStep(
      'cashu.manager.melt_watchers_disabled',
      'cashu.manager.melt_watchers_disable_failed',
      async () => {
        await instance.disableMeltSettlementProcessor();
        await instance.disableMeltQuoteWatcher();
      }
    );
  }

  /** Close and remove a database an initialise opened across a reset. */
  private static async discardAfterReset(
    db: { closeAsync(): Promise<void> },
    dbName: string
  ): Promise<void> {
    cashuLog.warn('cashu.manager.initialize.discarded_after_reset', { dbName });
    await db.closeAsync().catch(() => undefined);
    await this.deleteDatabase(dbName).catch(() => undefined);
  }

  /**
   * Delete a single coco database by name. Throws when the database or its
   * backups could not be removed: both hold spendable proofs, and a delete-all
   * that reported success over them would clear the keys and leave the money.
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
        throw fsError;
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
      throw error;
    }
  }

  /**
   * Complete reset: delete ALL coco databases (all profiles including imported)
   * and reset the manager. Used for "Delete Account" / full app reset.
   * @param accountIndexes All profile account indexes (derived 0,1,2... and imported npubNumbers).
   */
  static async completeReset(accountIndexes: number[]): Promise<void> {
    // From here an initialise that is still running discards its own result.
    this.resetGeneration += 1;
    try {
      await this.disarmForegroundGate();
      // An initialise in flight would finish after the databases are deleted
      // and recreate one. Give it a bounded wait so it can be disposed below;
      // one that never settles must not hold the wipe for good (it discards
      // its own result when it does finish).
      if (this.life.phase === 'opening') {
        await settleWithin(
          this.life.opened.catch(() => undefined),
          RESET_INIT_WAIT_MS
        );
      }
      // Whatever wallet and database are open now are the reset's to close.
      const life = this.life;
      const wallet =
        life.phase === 'ready' ? life : life.phase === 'closing' ? life.holding.wallet : null;
      if (wallet) {
        await this.disableWatchers(wallet.instance);
        await this.teardownStep('cashu.manager.disposed', 'cashu.manager.dispose_failed', () =>
          wallet.instance.dispose()
        );
      }
      const db = wallet?.db ?? (life.phase === 'opening' ? life.acquired.db : null);
      if (life.phase === 'opening') life.acquired.db = null;
      // A close in flight ends on its own; it finds nothing left to close.
      if (life.phase === 'closing') life.holding.wallet = null;
      else this.life = { phase: 'closed' };
      // The native module refuses to delete a database that is still open.
      if (db) {
        await db.closeAsync().catch((error: unknown) => {
          cashuLog.warn('cashu.manager.reset_close_failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }

      const dbNames = new Set<string>();
      for (const i of accountIndexes) {
        dbNames.add(this.dbNameFor(i));
      }
      // Delete-all means every wallet database on the phone. One can outlive
      // its account's row in the list (a removal that was interrupted, a list
      // that lost an entry), so the directory is read as well as the list.
      // The listed ones are deleted whatever happens to the listing; a listing
      // that fails is thrown after them, so the wipe is reported incomplete.
      let unlisted: string[] = [];
      let listingError: unknown = null;
      try {
        unlisted = await this.walletDatabasesOnDisk();
      } catch (error) {
        listingError = error;
        cashuLog.error('cashu.manager.db_directory_unreadable', { error: redactError(error) });
      }
      for (const dbName of unlisted) dbNames.add(dbName);
      for (const dbName of dbNames) {
        await this.deleteDatabase(dbName);
      }
      if (listingError) throw new Error('Wallet databases could not be listed');

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

registerAccountScoped('wallet.reusable-quote-flights', disposeReusableQuoteFlights);
registerAccountScoped('wallet.melt-target', resetMeltTarget);
registerAccountScoped('wallet.cashu-seed', () => CocoManager.disposeSeed());
