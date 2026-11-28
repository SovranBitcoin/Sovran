// ---------------------------------------------------------------------------
// Batcher — coalesce per-key loads into one request per window
//
// A list renders N rows and each asks for its own entity. Without this, that
// is N requests per source. `load(key)` instead parks the key for one frame;
// everything asked for in that window goes out as ONE `fetch(keys)`, and each
// caller is resolved from the shared answer.
//
// - In-flight dedupe: a key that is queued or being fetched returns the
//   promise already in hand, so five rows showing one person ask once.
// - `maxKeys` bounds one request (relay `authors` filters and cache verbs both
//   have practical limits); a fuller queue goes out as several.
// - `fetch` hands back a resolver per key rather than one result, because an
//   aggregate read settles key by key: a key the first source answered need
//   not wait for the slowest source to give up on another.
// ---------------------------------------------------------------------------

export type BatcherOptions<V> = {
  /** How long a key waits for company before the batch goes out. Default 16 ms (one frame). */
  windowMs?: number;
  /** Most keys in one `fetch`. Default 100. */
  maxKeys?: number;
  /** Start one request for `keys`; the returned function resolves each key from it. Must not throw. */
  fetch(keys: string[]): (key: string) => Promise<V>;
};

export interface Batcher<V> {
  /** The value for `key`, from the batch it joins or the one already carrying it. */
  load(key: string): Promise<V>;
  /** True while `key` is queued or its batch has not settled it. */
  has(key: string): boolean;
}

export function createBatcher<V>(options: BatcherOptions<V>): Batcher<V> {
  const windowMs = options.windowMs ?? 16;
  const maxKeys = Math.max(1, options.maxKeys ?? 100);
  const inFlight = new Map<string, Promise<V>>();
  let queue: { key: string; resolve: (value: V | Promise<V>) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    const batch = queue;
    queue = [];
    for (let start = 0; start < batch.length; start += maxKeys) {
      const chunk = batch.slice(start, start + maxKeys);
      const resolveKey = options.fetch(chunk.map((entry) => entry.key));
      for (const entry of chunk) entry.resolve(resolveKey(entry.key));
    }
  }

  return {
    load(key) {
      const existing = inFlight.get(key);
      if (existing) return existing;
      const promise = new Promise<V>((resolve) => {
        queue.push({ key, resolve });
      });
      inFlight.set(key, promise);
      const release = () => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      };
      promise.then(release, release);
      if (queue.length >= maxKeys) flush();
      else timer ??= setTimeout(flush, windowMs);
      return promise;
    },
    has(key) {
      return inFlight.has(key);
    },
  };
}
