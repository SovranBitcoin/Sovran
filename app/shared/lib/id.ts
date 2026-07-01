/**
 * Mint a process-local unique id with a human-readable prefix.
 *
 * Uses Date.now() for ordering plus an incrementing counter to disambiguate
 * within the same millisecond. The counter is module-scoped so it does not
 * survive a relaunch, which is fine because every consumer treats these ids
 * as ephemeral (history-entry keys, optimistic chat-message keys).
 *
 * Why: `${prefix}-${Date.now()}` collides when the JS event loop dispatches
 * two creators within the same ms tick. Audit 49 F-016 (bitchat own-message)
 * and audit 52 F-002 (whitenoise pending-message) both flagged this; this
 * helper is the canonical fix so future call sites cannot regress.
 */
let counter = 0;

export function mintLocalId(prefix: string): string {
  counter = (counter + 1) | 0;
  return `${prefix}-${Date.now()}-${counter}`;
}
