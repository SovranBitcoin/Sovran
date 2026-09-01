/**
 * @fileoverview Per-request abort/timeout composition.
 *
 * Leaf module: it reaches colada through the `wallet/safeFetch` SUBPATH, not
 * the barrel — the barrel statically re-exports `createColada` and the LNURL
 * surface, so importing it here would make the whole wallet engine reachable
 * from anything that needs a request signal.
 */
import { combineSignals, timeoutSignal, type RequestControls } from 'wallet/safeFetch';

/** Default per-request ceiling. LNURL and mint endpoints are arbitrary
 *  third-party hosts, so this is deliberately generous. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Compose a caller's abort signal with the per-request timeout into the
 * `signal` to hand to `fetch`. Throw-style callers (e.g. shared/lib/routstr,
 * which surfaces errors via thrown `RoutstrError`) reach for this so they
 * stop bypassing the timeout while keeping their existing exception flow.
 */
export function buildAbortSignal(controls: RequestControls = {}): AbortSignal {
  const { signal: callerSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = controls;
  return combineSignals(callerSignal, timeoutSignal(timeoutMs));
}
