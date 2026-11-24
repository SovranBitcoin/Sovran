/**
 * The line Delete All draws under every write that was already on its way.
 *
 * A read that started before the wipe can finish after the storage is cleared
 * and, through a persisted store, write the deleted install's data back. A
 * writer that can outlive an `await` takes `dataResetGeneration()` when it
 * starts and writes only if it is unchanged when it lands; Delete All calls
 * `fenceDataReset()` before it clears storage. Writers that keep their own
 * session state (single-flight maps, generations) clear it in `onDataReset`.
 *
 * Imports nothing, so the profile orchestrator can call it without pulling
 * feature code into its module graph.
 */
let generation = 0;
const listeners = new Set<() => void>();

/** Changes every time Delete All starts clearing storage. */
export function dataResetGeneration(): number {
  return generation;
}

/** Runs `listener` each time Delete All fences; returns its removal. */
export function onDataReset(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by Delete All before it clears storage: every earlier writer is now stale. */
export function fenceDataReset(): void {
  generation += 1;
  for (const listener of [...listeners]) listener();
}
