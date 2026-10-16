export const TIMED_OUT = Symbol('timed-out');

/**
 * Bound a wait made while the transition lock is held. A promise that never
 * settles would otherwise keep the lock, and with it every other account
 * flow, until the app is restarted. The work is not cancelled, only no longer
 * waited for, so the caller must give up in a way that is safe if it finishes
 * later.
 */
export async function settleWithin<T>(
  work: Promise<T>,
  timeoutMs: number
): Promise<T | typeof TIMED_OUT> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMED_OUT>((resolve) => {
        handle = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}
