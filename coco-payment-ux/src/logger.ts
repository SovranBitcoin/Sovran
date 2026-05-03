// ---------------------------------------------------------------------------
// logger — UI-agnostic logger seam
//
// Internal modules log through `logger` instead of reaching for `console.*`
// directly. The default implementation is a no-op so the package stays
// runtime- and consumer-agnostic; consumers inject a real `Logger` (e.g.
// sovran-app's `paymentLog`) by passing `logger` to `createCocoPaymentUX`,
// which forwards the value to `setLogger`.
//
// One adapter is the no-op default (used by tests and standalone consumers);
// the other is whatever consumer-supplied logger is wired in. That makes
// this a real seam, not pass-through indirection.
// ---------------------------------------------------------------------------

export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

let current: Logger = noopLogger;

/**
 * Replace the package-wide logger. Pass `null` to reset to the no-op
 * default. Intended to be called once at boot from the consumer; a host
 * with multiple concurrent payment surfaces would clobber prior wiring.
 */
export function setLogger(next: Logger | null): void {
  current = next ?? noopLogger;
}

/**
 * Package-wide logger. Always read through this binding so swapping the
 * underlying implementation via `setLogger` takes effect for every caller.
 */
export const logger: Logger = {
  debug: (event, fields) => current.debug(event, fields),
  info: (event, fields) => current.info(event, fields),
  warn: (event, fields) => current.warn(event, fields),
  error: (event, fields) => current.error(event, fields),
};

/**
 * Normalize an unknown thrown value into a logger field. Errors keep
 * their message; everything else is coerced to a string. Use this in
 * catch blocks so the log fields stay structured.
 */
export function errField(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return String(e);
  } catch {
    return '<unloggable>';
  }
}
