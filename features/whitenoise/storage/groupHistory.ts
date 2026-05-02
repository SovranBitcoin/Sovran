import { bytesToHex } from '@noble/hashes/utils.js';
import { deserializeApplicationRumor, type BaseGroupHistory } from '@internet-privacy/marmot-ts';
import { AsyncStorageKVBackend } from './asyncStorageBackend';
import { WhitenoiseNamespace, whitenoisePrefix } from './namespaces';

/**
 * Marmot saves every sent + received application-message rumor (as bytes) to
 * `BaseGroupHistory.saveMessage`. Without a history backend the messages live
 * only in React state and disappear on app restart. This adapter persists
 * them per group via AsyncStorage and exposes a `loadMessages()` method our
 * UI calls on mount.
 */
type StoredApplicationRumor = {
  bytes: Uint8Array;
  receivedAt: number;
};

export class WhitenoiseGroupHistory implements BaseGroupHistory {
  private readonly storageKey: string;
  private readonly backend: AsyncStorageKVBackend<StoredApplicationRumor[]>;
  // saveMessage is fire-and-forget from marmot-ts (send path + ingest path).
  // The read-await-modify-write sequence races when a peer's kind-445 event
  // arrives during a local send: both calls read the same `existing`, both
  // push, the second setItem silently overwrites the first. Serialize through
  // a per-instance promise chain — chain failures swallowed so one rejection
  // doesn't poison subsequent writes.
  private writeChain: Promise<void> = Promise.resolve();

  constructor(accountIndex: number, groupId: Uint8Array) {
    this.backend = new AsyncStorageKVBackend<StoredApplicationRumor[]>(
      whitenoisePrefix(accountIndex, WhitenoiseNamespace.History)
    );
    this.storageKey = bytesToHex(groupId);
  }

  async saveMessage(message: Uint8Array): Promise<void> {
    const next = this.writeChain.then(async () => {
      const existing = (await this.backend.getItem(this.storageKey)) ?? [];
      existing.push({ bytes: message, receivedAt: Date.now() });
      await this.backend.setItem(this.storageKey, existing);
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async purgeMessages(): Promise<void> {
    await this.backend.removeItem(this.storageKey);
  }

  /** App-level extension: read everything we've stored, deserialized. */
  async loadMessages(): Promise<
    Array<{ rumor: ReturnType<typeof deserializeApplicationRumor>; receivedAt: number }>
  > {
    const stored = (await this.backend.getItem(this.storageKey)) ?? [];
    return stored
      .map((s) => {
        try {
          return { rumor: deserializeApplicationRumor(s.bytes), receivedAt: s.receivedAt };
        } catch {
          return null;
        }
      })
      .filter(
        (
          x
        ): x is {
          rumor: ReturnType<typeof deserializeApplicationRumor>;
          receivedAt: number;
        } => x !== null
      );
  }
}

export function createWhitenoiseGroupHistoryFactory(
  accountIndex: number
): (groupId: Uint8Array) => WhitenoiseGroupHistory {
  return (groupId: Uint8Array) => new WhitenoiseGroupHistory(accountIndex, groupId);
}
