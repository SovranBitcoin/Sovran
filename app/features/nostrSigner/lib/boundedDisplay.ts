/**
 * @fileoverview Untrusted-display length bounding — the single choke point
 *
 * Display strings derived from request params (app names, peer keys, relay
 * hosts, event content, d-tags) are untrusted: everything destined for the UI
 * passes through `boundDisplay` and is never logged. Lives in lib/ so both
 * the headless engine layer (requestSummary, appDataOps) and the components
 * layer (permissionCatalog) can import it without a components-from-lib
 * layering violation.
 */

import { Result } from 'neverthrow';

export const MAX_APP_NAME_DISPLAY = 48;
export const MAX_CONTEXT_LABEL_DISPLAY = 64;

export const UNNAMED_APP_LABEL = 'Unnamed app';

/** Length-bound an untrusted display string; never log the value. */
export function boundDisplay(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Hostname of a (https) url, or an error sentinel — the url may embed a secret. */
export const safeHostname = Result.fromThrowable(
  (url: string) => new URL(url).hostname,
  () => 'invalid_url' as const
);
