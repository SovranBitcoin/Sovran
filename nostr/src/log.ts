// Settable structured logger for the tiered data layer. Default is a no-op so
// the library is silent in production; a consumer flips it on with
// `setNostrLogger(...)` (e.g. bridge it into the app's logger, or use the
// `consoleNostrLogger` below) to validate tier selection, fallback, protocol
// traffic, demux counts, and ordering as reads flow through the facade.
//
// A settable module-level logger (rather than threading a logger param through
// every function) keeps the instrumentation friction-free: each module imports
// `nostrLog` and emits events; the active sink is swapped globally.

export type NostrLogData = Record<string, unknown>;

export interface NostrLogger {
  debug(event: string, data?: NostrLogData): void;
  info(event: string, data?: NostrLogData): void;
  warn(event: string, data?: NostrLogData): void;
}

const noopLogger: NostrLogger = {
  debug() {},
  info() {},
  warn() {},
};

let active: NostrLogger = noopLogger;

/** The logger every data-layer module emits through. Calls route to the active sink. */
export const nostrLog: NostrLogger = {
  debug: (event, data) => active.debug(event, data),
  info: (event, data) => active.info(event, data),
  warn: (event, data) => active.warn(event, data),
};

/** Install a sink (or `null` to silence). */
export function setNostrLogger(logger: NostrLogger | null): void {
  active = logger ?? noopLogger;
}

/** A ready-made console sink for quick local validation. */
export const consoleNostrLogger: NostrLogger = {
  debug: (event, data) => console.debug(`[nostr] ${event}`, data ?? ''),
  info: (event, data) => console.info(`[nostr] ${event}`, data ?? ''),
  warn: (event, data) => console.warn(`[nostr] ${event}`, data ?? ''),
};
