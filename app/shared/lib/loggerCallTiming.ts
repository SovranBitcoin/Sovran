// ═══════════════════════════════════════════════════════════════════════════════
// CALL TIMING — a transparent Proxy that times every method call on an object
// ═══════════════════════════════════════════════════════════════════════════════
//
// Wraps an object once, at the place it is handed out, so its callers are timed
// without each of them adding a span. Every call emits one `event` entry with
// the method path (`wallet.receive`, `ops.send.prepare`) and its duration.
//
// What it preserves, because callers rely on all of it:
//   - identity: one proxy per target, one wrapper per method, one proxy per
//     namespace — `timed.wallet === timed.wallet`, so the result can be a
//     WeakMap key or compared with `!==` like the object it stands in for.
//   - `this`: methods run against the REAL object, never the proxy, so code
//     that reads its own fields behaves as if the proxy were not there.
//   - results: a sync value or the ORIGINAL promise is returned untouched; the
//     timer observes the promise on a side branch and never replaces it.
//   - errors: a throw or rejection reaches the caller unchanged.
//
// Arguments and results are never logged — only the path, the duration and
// whether the call succeeded.

import { monotonicNow, type Logger } from './loggerCore';

interface CallTimingOptions {
  /** Event name, e.g. `coco.call`. */
  event: string;
  logger: Logger;
  /**
   * Object-valued properties of the root to descend into. Anything else on the
   * root is handed back as-is, so private collaborators are left alone.
   */
  namespaces: readonly string[];
  /** How many levels of nested namespace to follow below the root. Default 3. */
  maxDepth?: number;
}

type AnyFunction = (this: unknown, ...args: unknown[]) => unknown;

/** Containers whose methods are not calls worth timing, and promises. */
function isOpaque(value: object): boolean {
  return (
    Array.isArray(value) ||
    ArrayBuffer.isView(value) ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof Date ||
    value instanceof Promise
  );
}

/**
 * Native promises only. Reading or calling `then` on an arbitrary thenable can
 * run its code early or throw, which an unwrapped call would never do.
 */
function isThenable(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

/**
 * A Proxy `get` must hand back the real value of a non-configurable,
 * non-writable data property, or the engine throws.
 */
function isFrozenProperty(target: object, prop: string | symbol): boolean {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, prop);
  return descriptor !== undefined && !descriptor.configurable && descriptor.writable === false;
}

/**
 * Return `target` behind a timing Proxy, or `target` itself when `logger`
 * would not emit debug entries — so a release build pays nothing.
 */
export function withCallTiming<T extends object>(target: T, options: CallTimingOptions): T {
  const { event, logger, maxDepth = 3 } = options;
  if (!logger.isLevelEnabled('debug')) return target;
  const namespaces = new Set<string | symbol>(options.namespaces);

  function report(method: string, startedAt: number, async: boolean, ok: boolean): void {
    logger.debug(event, () => ({
      method,
      duration_ms: Math.round((monotonicNow() - startedAt) * 100) / 100,
      async,
      ok,
    }));
  }

  function wrap(node: object, path: string, depth: number): object {
    // Keyed by property, remembering the raw value it was built from so a
    // reassigned property gets a fresh wrapper instead of a stale one.
    const cache = new Map<string | symbol, { raw: unknown; wrapped: unknown }>();

    const proxy: object = new Proxy(node, {
      get(nodeTarget, prop) {
        // Read against the real object: getters see their own `this`.
        const raw: unknown = Reflect.get(nodeTarget, prop, nodeTarget);
        if (typeof prop === 'symbol' || prop === 'constructor') return raw;
        const isFunction = typeof raw === 'function';
        if (!isFunction && (typeof raw !== 'object' || raw === null)) return raw;

        // Checked on every read, before the cache: an object frozen after a
        // wrapper was handed out must get its real value back from then on.
        if (isFrozenProperty(nodeTarget, prop)) return raw;
        const cached = cache.get(prop);
        if (cached && cached.raw === raw) return cached.wrapped;

        const childPath = path ? `${path}.${prop}` : prop;
        let wrapped: unknown = raw;
        if (isFunction) {
          wrapped = timeFunction(raw as AnyFunction, nodeTarget, proxy, childPath);
        } else if (
          (depth > 0 || namespaces.has(prop)) &&
          depth < maxDepth &&
          !isOpaque(raw as object)
        ) {
          wrapped = wrap(raw as object, childPath, depth + 1);
        }
        cache.set(prop, { raw, wrapped });
        return wrapped;
      },
    });
    return proxy;
  }

  function timeFunction(fn: AnyFunction, owner: object, ownerProxy: object, method: string) {
    return function timedCall(this: unknown, ...args: unknown[]): unknown {
      const startedAt = monotonicNow();
      let result: unknown;
      try {
        // Called through the proxy → run against the real owner. An explicit
        // `.call(other)` keeps the receiver the caller chose.
        result = Reflect.apply(fn, this === ownerProxy ? owner : this, args);
      } catch (error) {
        report(method, startedAt, false, false);
        throw error;
      }
      if (isThenable(result)) {
        // A side branch: the caller still gets the original promise, and its
        // rejection stays the caller's to handle.
        result.then(
          () => report(method, startedAt, true, true),
          () => report(method, startedAt, true, false)
        );
        return result;
      }
      report(method, startedAt, false, true);
      return result;
    };
  }

  return wrap(target, '', 0) as T;
}
