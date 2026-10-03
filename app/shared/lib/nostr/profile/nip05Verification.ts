import { parseNip05Identifier, verifyNip05, type Nip05Verification } from 'wallet';

export interface Nip05Check {
  result: Nip05Verification;
  expiresAt: number;
}
// Public domain-to-key assertions only. Never persist trust or provider validity flags.
const cache = new Map<string, Nip05Check>();
const pending = new Map<string, Promise<Nip05Check>>();
const queue: (() => void)[] = [];
const listeners = new Map<string, Set<() => void>>();
let active = 0;
const keyFor = (address: string, pubkey: string) =>
  JSON.stringify([
    parseNip05Identifier(address)?.identifier ?? address.trim().toLowerCase(),
    pubkey,
  ]);

export function cachedNip05Check(address: string, pubkey: string): Nip05Check | undefined {
  const entry = cache.get(keyFor(address, pubkey));
  return entry && entry.expiresAt > Date.now() ? entry : undefined;
}

export function forgetNip05Check(address: string, pubkey: string): void {
  const key = keyFor(address, pubkey);
  cache.delete(key);
  notify(key);
}

export function subscribeNip05Check(
  address: string,
  pubkey: string,
  listener: () => void
): () => void {
  const key = keyFor(address, pubkey);
  const subscribers = listeners.get(key) ?? new Set<() => void>();
  subscribers.add(listener);
  listeners.set(key, subscribers);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) listeners.delete(key);
  };
}

function notify(key: string): void {
  for (const listener of listeners.get(key) ?? []) listener();
}

/** Shared, bounded reads for visible contacts and the nearby directory's warm-up. */
export function checkNip05Identity(address: string, pubkey: string): Promise<Nip05Check> {
  const key = keyFor(address, pubkey);
  const cached = cachedNip05Check(address, pubkey);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 64) {
    const entry: Nip05Check = {
      result: { status: 'error', reason: 'network' },
      expiresAt: Date.now() + 60_000,
    };
    remember(key, entry);
    return Promise.resolve(entry);
  }
  const job = new Promise<Nip05Check>((resolve) => {
    const start = () => {
      active += 1;
      const complete = (result: Nip05Verification) => {
        const entry = {
          result,
          expiresAt: Date.now() + (result.status === 'verified' ? 900_000 : 60_000),
        };
        remember(key, entry);
        pending.delete(key);
        active -= 1;
        queue.shift()?.();
        resolve(entry);
      };
      void verifyNip05(address, pubkey).then(complete, () =>
        complete({ status: 'error', reason: 'network' })
      );
    };
    if (active < 4) start();
    else queue.push(start);
  });
  pending.set(key, job);
  return job;
}

function remember(key: string, entry: Nip05Check): void {
  cache.delete(key);
  cache.set(key, entry);
  notify(key);
  while (cache.size > 128) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
    notify(oldest);
  }
}
