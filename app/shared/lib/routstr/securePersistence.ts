import { trackProfilePersistWrite } from '@/shared/lib/persist/profileWriteBarrier';
import { z } from 'zod';
import type { StateStorage } from 'zustand/middleware';

import {
  NoProfileYetError,
  captureProfileStorageOwner,
  createProfileScopedStorage,
  profileStorageOwnerAppears,
} from '@/shared/lib/cashu/profileScopedStorage';
import { createSecureVault } from '../persist/secureVault';

const Envelope = z.looseObject({ state: z.record(z.string(), z.unknown()) });
const Secrets = z.object({
  apiKey: z.string().max(8192).nullable().default(null),
  legacyAccounts: z
    .record(z.string().max(512), z.looseObject({ apiKey: z.string().max(8192) }))
    .default({}),
  pendingPayments: z
    .record(
      z.string().max(128),
      z.looseObject({
        encoded: z.string().max(65_536),
        nodeBaseUrl: z.string().max(512),
        operationId: z.string().max(128),
      })
    )
    .default({}),
});
const EMPTY = { apiKey: null, legacyAccounts: {}, pendingPayments: {} };

/** Inspect legacy plaintext payment fields without hydrating or migrating the account. */
export function assertRoutstrStorageEmptyForRemoval(raw: string | null): void {
  if (raw === null) return;
  const envelope = Envelope.parse(JSON.parse(raw));
  const secrets = Secrets.parse(envelope.state);
  if (
    secrets.apiKey !== null ||
    Object.keys(secrets.legacyAccounts).length > 0 ||
    Object.keys(secrets.pendingPayments).length > 0
  ) {
    throw new Error('Provider payment records require review');
  }
}

interface RoutstrPersistenceOptions {
  /**
   * Called once when a load found no account and one has since appeared, so
   * the store can load again. Without it the store would stay on what it read
   * before the account existed: nothing.
   */
  onFirstAccount?: () => void;
}

/** Keep credentials out of the chat blob without changing its public store shape. */
export function createRoutstrPersistence(options: RoutstrPersistenceOptions = {}): StateStorage {
  const queues = new Map<string, Promise<void>>();
  /**
   * Blobs this process has read. The store persists whatever it holds on every
   * `set`, hydrated or not, so a read that failed — the keychain is locked
   * when iOS launches the app in the background — leaves it holding defaults
   * that the first write after the unlock would put in place of the key, the
   * recovery tokens and every session. A blob may be created unread; it may
   * not be replaced unread.
   */
  const read = new Set<string>();
  /**
   * The account everything is filed under, or null before any account has a
   * row: the first launch, until the keys provider adds account 0. Other
   * per-account stores use the bare key in that window. This one cannot. The
   * vault is named by the account, and a bare blob from an old release may
   * hold a key in plain text that only a load for its account moves out.
   */
  async function ownerIfAny(): Promise<string | null> {
    try {
      return await captureProfileStorageOwner();
    } catch (error) {
      if (error instanceof NoProfileYetError) return null;
      throw error;
    }
  }
  let waitingForAccount = false;
  function run<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const result = (queues.get(owner) ?? Promise.resolve()).then(action);
    queues.set(
      owner,
      result.then(
        () => {},
        () => {}
      )
    );
    return result;
  }

  async function load(owner: string, name: string) {
    // Persist's outer barrier owns and drains the whole secure-storage operation.
    const storage = createProfileScopedStorage(owner, true);
    const vault = createSecureVault(owner, name);
    const raw = await storage.getItem(name);
    const secure = await vault.read();
    const envelope = raw === null ? null : Envelope.parse(JSON.parse(raw));
    const legacy = Secrets.parse(envelope?.state ?? {});
    const hasLegacy =
      legacy.apiKey !== null ||
      Object.keys(legacy.legacyAccounts).length > 0 ||
      Object.keys(legacy.pendingPayments).length > 0;
    let secrets = secure === null ? EMPTY : Secrets.parse(JSON.parse(secure));
    if (hasLegacy) {
      if (secure !== null && JSON.stringify(secrets) !== JSON.stringify(legacy)) {
        throw new Error('Conflicting provider credentials require recovery');
      }
      await vault.write(JSON.stringify(legacy));
      secrets = legacy;
      // The secure generation is verified before the plaintext copy changes.
      await storage.setItem(
        name,
        JSON.stringify({ ...envelope, state: { ...envelope?.state, ...EMPTY } })
      );
    }
    return {
      storage,
      vault,
      envelope,
      secrets,
      secureRaw: hasLegacy ? JSON.stringify(legacy) : secure,
    };
  }

  return {
    getItem(name) {
      // Reads may migrate plaintext credentials. Drain that entire operation before switching.
      return trackProfilePersistWrite(
        (async () => {
          const owner = await ownerIfAny();
          if (owner === null) {
            // Nothing is filed under an account that does not exist. Report
            // nothing stored, and have the store load again once it does.
            if (!waitingForAccount) {
              waitingForAccount = true;
              void profileStorageOwnerAppears().then(() => {
                waitingForAccount = false;
                options.onFirstAccount?.();
              });
            }
            return null;
          }
          return run(owner, async () => {
            const { envelope, secrets } = await load(owner, name);
            read.add(`${owner}:${name}`);
            if (!envelope && secrets === EMPTY) return null;
            return JSON.stringify({
              version: 1,
              ...envelope,
              state: { ...envelope?.state, ...secrets },
            });
          });
        })()
      );
    },
    async setItem(name, value) {
      const owner = await ownerIfAny();
      // No account to file this under, and never the bare key. The store keeps
      // it in memory, and its next save after the account exists carries it.
      if (owner === null) return;
      return run(owner, async () => {
        const { storage, vault, secureRaw, envelope: stored } = await load(owner, name);
        if (!read.has(`${owner}:${name}`)) {
          if (stored !== null || secureRaw !== null) {
            throw new Error('Provider storage was never read; refusing to replace it');
          }
          read.add(`${owner}:${name}`);
        }
        const envelope = Envelope.parse(JSON.parse(value));
        const secrets = Secrets.parse(envelope.state);
        const nextSecrets = JSON.stringify(secrets);
        if (nextSecrets !== secureRaw) await vault.write(nextSecrets);
        await storage.setItem(
          name,
          JSON.stringify({ ...envelope, state: { ...envelope.state, ...EMPTY } })
        );
      });
    },
    async removeItem(name) {
      const owner = await ownerIfAny();
      if (owner === null) return;
      return run(owner, async () => {
        const { storage } = await load(owner, name);
        // Clearing a chat store is not evidence that a provider paid back its
        // balance. Retain recovery material until the explicit Delete All flow.
        await storage.removeItem(name);
      });
    },
  };
}
