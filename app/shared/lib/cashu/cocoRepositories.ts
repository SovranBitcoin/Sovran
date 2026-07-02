import type {
  Keypair,
  KeypairPurpose,
  KeyRingRepository,
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
}

function overlayRepositoryScope(
  scope: RepositoryTransactionScope,
  keyRing: KeyRingRepository | null
): RepositoryTransactionScope {
  return {
    ...scope,
    ...(keyRing ? { keyRingRepository: keyRing } : {}),
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
    ...overlayRepositoryScope(repositories, keyRing),
    init: () => repositories.init(),
    withTransaction: async (fn) => {
      const startedAt = Date.now();
      cashuLog.debug('cashu.repository.transaction.start', {
        hasEphemeralKeyring: ephemeralPubkeys.size > 0,
      });
      try {
        const result = await repositories.withTransaction((scope) =>
          fn(overlayRepositoryScope(scope, keyRing))
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
