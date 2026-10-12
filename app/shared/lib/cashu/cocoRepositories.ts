import type {
  CounterRepository,
  Keypair,
  KeypairPurpose,
  KeyRingRepository,
  ProofRepository,
  Repositories,
  RepositoryTransactionScope,
} from '@cashu/coco-core/adapter';
import { cashuLog } from '@/shared/lib/logger';

/**
 * The overlay only ever holds the active profile's Nostr signer key, imported
 * by the p2pk-import plugin — purpose `p2pk`. A `nut20_mint_quote` query must
 * never be answered from the overlay, or coco could NUT-20-sign a mint quote
 * with the profile identity key.
 */
function overlayServesPurpose(purpose: KeypairPurpose | undefined): boolean {
  return purpose === undefined || purpose === 'p2pk';
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
 * keeps persisting through the delegate unchanged. All reads thread coco v2's
 * `purpose` parameter through to the delegate and consult the overlay only
 * for p2pk-compatible queries.
 */
function wrapKeyRingRepository(
  repository: KeyRingRepository,
  ephemeralPubkeys: ReadonlySet<string>,
  overlay: Map<string, Keypair>
): KeyRingRepository {
  return {
    getPersistedKeyPair: async (publicKey, purpose) => {
      if (overlayServesPurpose(purpose)) {
        const overlayKeyPair = overlay.get(publicKey);
        if (overlayKeyPair) {
          cashuLog.debug('cashu.repository.keyring.overlay_hit', {
            overlaySize: overlay.size,
            purpose: purpose ?? null,
          });
          return overlayKeyPair;
        }
      }
      return repository.getPersistedKeyPair(publicKey, purpose);
    },
    setPersistedKeyPair: async (keyPair) => {
      if (ephemeralPubkeys.has(keyPair.publicKeyHex) && (keyPair.purpose ?? 'p2pk') === 'p2pk') {
        overlay.set(keyPair.publicKeyHex, keyPair);
        cashuLog.info('cashu.repository.keyring.ephemeral_set', {
          overlaySize: overlay.size,
          ephemeralCount: ephemeralPubkeys.size,
        });
        // Scrub any legacy plaintext row written by builds that predate the
        // overlay. Exact primary-key match — cannot touch other keys.
        await repository.deletePersistedKeyPair(keyPair.publicKeyHex, 'p2pk');
        cashuLog.info('cashu.repository.keyring.ephemeral_scrubbed', {
          overlaySize: overlay.size,
        });
        return;
      }
      return repository.setPersistedKeyPair(keyPair);
    },
    deletePersistedKeyPair: async (publicKey, purpose) => {
      if (overlayServesPurpose(purpose)) {
        const removedOverlay = overlay.delete(publicKey);
        if (removedOverlay) {
          cashuLog.debug('cashu.repository.keyring.overlay_deleted', {
            overlaySize: overlay.size,
          });
        }
      }
      return repository.deletePersistedKeyPair(publicKey, purpose);
    },
    getAllPersistedKeyPairs: async (purpose) => {
      const persisted = await repository.getAllPersistedKeyPairs(purpose);
      if (!overlayServesPurpose(purpose)) {
        return persisted;
      }
      const filtered = persisted.filter((keyPair) => !overlay.has(keyPair.publicKeyHex));
      cashuLog.debug('cashu.repository.keyring.all_loaded', {
        persistedCount: persisted.length,
        overlayCount: overlay.size,
        returnedCount: filtered.length + overlay.size,
        purpose: purpose ?? null,
      });
      return [...filtered, ...overlay.values()];
    },
    getLatestKeyPair: async (purpose) => {
      const latest = await repository.getLatestKeyPair(purpose);
      if (latest) {
        cashuLog.debug('cashu.repository.keyring.latest_loaded', { source: 'persisted' });
        return latest;
      }
      if (!overlayServesPurpose(purpose)) {
        return null;
      }
      const first = overlay.values().next();
      cashuLog.debug('cashu.repository.keyring.latest_loaded', {
        source: first.done ? 'none' : 'overlay',
        overlaySize: overlay.size,
      });
      return first.done ? null : first.value;
    },
    getLastDerivationIndex: (purpose) => repository.getLastDerivationIndex(purpose),
  };
}

interface SovranCocoRepositoriesOptions {
  /**
   * `02`-prefixed compressed pubkeys whose keypairs must stay in memory
   * instead of coco's plaintext SQLite keyring (the active profile's signer
   * key). Empty set → keyring passes through untouched.
   */
  ephemeralKeyringPubkeys?: ReadonlySet<string>;
  /**
   * Save `counter` for the keyset unless a higher one is already saved, in ONE
   * statement on the database's root connection. Without it the wrapper reads
   * the counter and then writes it, and a transaction (which runs on its own
   * connection and its own queue) can commit a higher value between the two,
   * which the write would then lower. See `raiseCounterStatement`.
   */
  raiseCounter?: (mintUrl: string, keysetId: string, counter: number) => Promise<void>;
}

/**
 * The statement behind `raiseCounter`, for Coco's counter table. It names
 * Coco's table and columns, so `__tests__/cocoCounterRaise.test.ts` runs it
 * against a wallet database written by the shipped Coco adapter.
 */
export const raiseCounterStatement = `INSERT INTO coco_cashu_counters (mintUrl, keysetId, counter)
       VALUES (?, ?, ?)
       ON CONFLICT(mintUrl, keysetId) DO UPDATE SET counter = MAX(counter, excluded.counter)`;

function overlayRepositoryScope(
  scope: RepositoryTransactionScope,
  keyRing: KeyRingRepository | null,
  counter: CounterRepository
): RepositoryTransactionScope {
  return {
    ...scope,
    ...(keyRing ? { keyRingRepository: keyRing } : {}),
    counterRepository: counter,
  };
}

type CounterTask = () => Promise<void>;

/** Serialize writes for one mint/keyset on a repository surface. Coco currently
 * performs counter read/modify/write as separate calls, so the app boundary
 * must at least prevent a stale writer from landing after a newer high-water
 * mark. Transaction scopes get their own queue because holding a root queue
 * while waiting on SQLite's exclusive transaction lock could deadlock. */
function createCounterWriteQueue(): (key: string, task: CounterTask) => Promise<void> {
  const tails = new Map<string, Promise<void>>();

  return async (key, task) => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      await task();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/** MAX-on-conflict counter repository. A restore, migration replay, or stale
 * service write may skip derivation indices, but can never reuse one by
 * lowering the persisted high-water mark.
 *
 * It also covers a Coco restore fault (follow-up F90): restore computes the
 * next counter as `last ? last + 1 : 0`, so when the only signature the mint
 * holds is at counter 0 it writes 0 and the next output repeats a signed one.
 * Coco writes that counter before it saves the proofs, and never saves spent
 * ones, so the write itself is the only reliable signal:
 *
 * - A keyset with no row reads as 0 here, so Coco's own first-use
 *   initialisation never writes 0. The only remaining write of 0 is the
 *   restore, which Coco reaches only after the mint returned a signature, so
 *   it is stored as 1.
 * - A wallet restored by an earlier build already holds the 0. While it still
 *   holds a proof for that keyset, the counter reads as 1. Coco advances the
 *   counter before any output is sent, so a held proof at counter 0 can only
 *   come from that restore; a wrong guess would skip one index, never reuse. */
function wrapCounterRepository(
  repository: CounterRepository,
  proofs: ProofRepository,
  enqueue: (key: string, task: CounterTask) => Promise<void>,
  /** Root connection only. Inside a transaction nothing else can write between a read and a write. */
  raise?: SovranCocoRepositoriesOptions['raiseCounter']
): CounterRepository {
  return {
    getCounter: async (mintUrl, keysetId) => {
      const stored = await repository.getCounter(mintUrl, keysetId);
      if (stored && stored.counter > 0) return stored;
      const held = await proofs.getProofsByKeysetId(mintUrl, keysetId);
      if (held.length === 0) return { mintUrl, keysetId, counter: 0 };
      // Saved, not only reported: once that proof is sent it is no longer
      // held, and the next read would go back to 0.
      // Another write may have raised the counter since the read above, so
      // the answer is whatever the queued task finds or leaves saved.
      let counter = 1;
      await enqueue(`${mintUrl}\u0000${keysetId}`, async () => {
        if (raise) {
          await raise(mintUrl, keysetId, 1);
          counter = (await repository.getCounter(mintUrl, keysetId))?.counter ?? 1;
          return;
        }
        const current = await repository.getCounter(mintUrl, keysetId);
        if (current && current.counter >= 1) {
          counter = current.counter;
          return;
        }
        await repository.setCounter(mintUrl, keysetId, 1);
      });
      cashuLog.info('cashu.repository.counter.zero_with_proofs_raised', { keysetId, counter });
      return { mintUrl, keysetId, counter };
    },
    setCounter: async (mintUrl, keysetId, requested) => {
      const counter = Math.max(requested, 1);
      await enqueue(`${mintUrl}\u0000${keysetId}`, async () => {
        if (raise) {
          // One statement: whatever is saved when it runs, the larger stays.
          await raise(mintUrl, keysetId, counter);
          cashuLog.debug('cashu.repository.counter.write_raised', { keysetId, requested, counter });
          return;
        }
        const current = await repository.getCounter(mintUrl, keysetId);
        if (current && current.counter >= counter) {
          cashuLog.debug('cashu.repository.counter.write_skipped', {
            keysetId,
            current: current.counter,
            requested,
          });
          return;
        }
        await repository.setCounter(mintUrl, keysetId, counter);
        cashuLog.debug('cashu.repository.counter.write_applied', {
          keysetId,
          previous: current?.counter ?? null,
          requested,
          counter,
        });
      });
    },
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
  const enqueueCounterWrite = createCounterWriteQueue();
  const counter = wrapCounterRepository(
    repositories.counterRepository,
    repositories.proofRepository,
    enqueueCounterWrite,
    options.raiseCounter
  );

  return {
    ...overlayRepositoryScope(repositories, keyRing, counter),
    init: () => repositories.init(),
    withTransaction: async (fn) => {
      const startedAt = Date.now();
      cashuLog.debug('cashu.repository.transaction.start', {
        hasEphemeralKeyring: ephemeralPubkeys.size > 0,
      });
      try {
        const result = await repositories.withTransaction((scope) => {
          const transactionCounter = wrapCounterRepository(
            scope.counterRepository,
            scope.proofRepository,
            createCounterWriteQueue()
          );
          return fn(overlayRepositoryScope(scope, keyRing, transactionCounter));
        });
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
