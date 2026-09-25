/**
 * @fileoverview The SDK's own diagnosis, without its token-bearing lane.
 *
 * `@routstr/sdk` was given `noopLogger` because its DEBUG stream prints raw
 * refund bodies and whole cashu tokens — logging that is not safe to keep. The
 * cost showed up the first time a request failed for a reason only the SDK
 * knew: a node refused a correctly priced 38-sat token from a mint it accepts,
 * and every trace of why was discarded. The app could only report its own
 * verdict, `no_providers`, which says that the walk ended, not what ended it.
 *
 * WARN and ERROR are a different lane from DEBUG. They carry the upstream
 * status, the failover decision and the refusal text — the answer to "why did
 * this provider fail" — so those two are forwarded and the other two stay
 * dropped. Values still pass through the app logger's redaction, which brands
 * anything token-, key- or invoice-shaped rather than printing it, so a stray
 * secret in a warning is caught by the same net as everywhere else.
 */

import { apiLog } from '@/shared/lib/logger';

/** `@routstr/sdk`'s logger seam. Varargs, console-style. */
interface SdkLogger {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: (prefix: string) => SdkLogger;
}

/** The leading string is the SDK's own message; the rest is its detail. */
function split(args: readonly unknown[]): { message: string; detail: unknown[] } {
  const [head, ...rest] = args;
  return typeof head === 'string'
    ? { message: head, detail: rest }
    : { message: '', detail: [...args] };
}

/**
 * Build a logger for the SDK, scoped by the child prefixes it asks for.
 *
 * `sink` exists so a test can assert what is forwarded and what is dropped
 * without reaching into the app logger.
 */
export function createSdkLogger(
  sink: Pick<typeof apiLog, 'warn' | 'error'> = apiLog,
  scope: string = ''
): SdkLogger {
  const emit =
    (level: 'warn' | 'error') =>
    (...args: unknown[]) => {
      const { message, detail } = split(args);
      sink[level](`routstr.sdk.${level}`, {
        scope,
        message,
        // Bounded by the logger's own compaction; present only when the SDK
        // actually passed something beyond its message.
        ...(detail.length > 0 ? { detail } : {}),
      });
    };

  return {
    // The lane that prints tokens and refund bodies. Never forwarded.
    log: () => {},
    debug: () => {},
    warn: emit('warn'),
    error: emit('error'),
    child: (prefix: string) => createSdkLogger(sink, scope ? `${scope}:${prefix}` : prefix),
  };
}
