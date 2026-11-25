/**
 * The active account as the app runtime holds it: which account scope is
 * mounted and its Nostr client. React reads it through `useSyncExternalStore`;
 * `appRuntime` and the account scope write it.
 */
import type { NostrClient } from 'nostr/client';

interface AccountHandle {
  /** The account whose scope is mounted, or null between accounts. */
  readonly accountIndex: number | null;
  /** That account's Nostr client, once its keys are loaded and the wallet is open. */
  readonly nostrClient: NostrClient | undefined;
}

let handle: AccountHandle = { accountIndex: null, nostrClient: undefined };
const listeners = new Set<() => void>();

function publish(next: AccountHandle): void {
  if (next.accountIndex === handle.accountIndex && next.nostrClient === handle.nostrClient) return;
  handle = next;
  listeners.forEach((listener) => listener());
}

export const accountHandle = {
  get: (): AccountHandle => handle,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setAccount(accountIndex: number | null): void {
    publish(
      accountIndex === null
        ? { accountIndex: null, nostrClient: undefined }
        : { ...handle, accountIndex }
    );
  },
  setNostrClient(client: NostrClient): void {
    publish({ ...handle, nostrClient: client });
  },
  /** Drops `client` if it is still the published one; a newer client stays. */
  clearNostrClient(client: NostrClient): void {
    if (handle.nostrClient === client) publish({ ...handle, nostrClient: undefined });
  },
};
