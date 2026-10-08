import { parseNip05Identifier, verifyNip05, type Nip05Verification } from 'wallet';

export interface Nip05Check {
  result: Nip05Verification;
  /** When this result should be re-fetched. It is still shown until then and
   *  while that re-fetch is in flight. */
  staleAt: number;
  /** When this result stops being shown at all. */
  expiresAt: number;
}

/** A verified mapping is re-checked every 15 minutes. */
const VERIFIED_FRESH_MS = 900_000;
/**
 * How long a verified mapping stays on screen without a successful re-check.
 * A refresh that cannot reach the domain (offline, timeout) does not remove
 * the checkmark inside this window — only an answer that contradicts it does.
 * Past it, an unreachable domain can no longer vouch for the key.
 */
const VERIFIED_HARD_MS = 3_600_000;
/** Everything else is retried after a minute. */
const UNVERIFIED_MS = 60_000;
const MAX_PENDING = 64;

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
export function checkNip05Identity(
  address: string,
  pubkey: string,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<Nip05Check> {
  const key = keyFor(address, pubkey);
  const cached = cachedNip05Check(address, pubkey);
  if (cached && !refresh) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= MAX_PENDING) {
    // Too busy to ask. That says nothing about this identity, so nothing is
    // cached: the caller keeps whatever it had and asks again later. Caching
    // a failure here painted unchecked people as "Could not verify".
    const now = Date.now();
    return Promise.resolve(
      cached ?? { result: { status: 'error', reason: 'network' }, staleAt: now, expiresAt: now }
    );
  }
  const job = new Promise<Nip05Check>((resolve) => {
    const start = () => {
      active += 1;
      const complete = (result: Nip05Verification) => {
        const entry = settle(cache.get(key), result, Date.now());
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

/**
 * The entry a finished check leaves behind. A verified mapping survives a
 * check that could not reach the domain, until its hard expiry; it never
 * survives an answer from the domain that disagrees.
 */
function settle(previous: Nip05Check | undefined, result: Nip05Verification, now: number) {
  if (result.status === 'verified') {
    return { result, staleAt: now + VERIFIED_FRESH_MS, expiresAt: now + VERIFIED_HARD_MS };
  }
  const unreachable = result.status === 'error' && result.reason === 'network';
  if (unreachable && previous?.result.status === 'verified' && previous.expiresAt > now) {
    return { ...previous, staleAt: Math.min(now + UNVERIFIED_MS, previous.expiresAt) };
  }
  // The domain named a different key. That warning is re-checked like any
  // other unverified answer, and stays on screen while it is: dropping to
  // "checking" every minute took the red mark off an impersonator's address
  // for as long as the domain took to answer again.
  if (result.status === 'mismatch') {
    return { result, staleAt: now + UNVERIFIED_MS, expiresAt: now + VERIFIED_HARD_MS };
  }
  return { result, staleAt: now + UNVERIFIED_MS, expiresAt: now + UNVERIFIED_MS };
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
