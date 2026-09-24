import { z } from 'zod';
import type { StateStorage } from 'zustand/middleware';

import {
  captureProfileStorageOwner,
  createProfileScopedStorage,
} from '@/shared/lib/cashu/profileScopedStorage';
import { createSecureVault } from './secureVault';

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

/** Keep credentials out of the chat blob without changing its public store shape. */
export function createRoutstrPersistence(): StateStorage {
  const queues = new Map<string, Promise<void>>();
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
    const storage = createProfileScopedStorage(owner);
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
    async getItem(name) {
      const owner = await captureProfileStorageOwner();
      return run(owner, async () => {
        const { envelope, secrets } = await load(owner, name);
        if (!envelope && secrets === EMPTY) return null;
        return JSON.stringify({
          version: 1,
          ...envelope,
          state: { ...envelope?.state, ...secrets },
        });
      });
    },
    async setItem(name, value) {
      const owner = await captureProfileStorageOwner();
      return run(owner, async () => {
        const { storage, vault, secureRaw } = await load(owner, name);
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
      const owner = await captureProfileStorageOwner();
      return run(owner, async () => {
        const { storage } = await load(owner, name);
        // Clearing a chat store is not evidence that a provider paid back its
        // balance. Retain recovery material until the explicit Delete All flow.
        await storage.removeItem(name);
      });
    },
  };
}
