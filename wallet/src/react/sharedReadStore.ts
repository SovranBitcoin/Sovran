export interface SharedReadStore<T> {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
}

/** Start reads on the first subscriber, retire them and the value on the last.
 * Store identities survive remounts (including an interrupted render), but a
 * subscription lifetime's publisher can never write into the next lifetime.
 */
export function createSharedReadStore<T>(
  initial: () => T,
  start: (publish: (snapshot: T) => void) => () => void,
): SharedReadStore<T> {
  let snapshot = initial();
  const listeners = new Set<() => void>();
  let stop: (() => void) | undefined;
  let generation = 0;
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      // Own each subscription separately even if callbacks happen to match.
      const notify = () => listener();
      listeners.add(notify);
      if (listeners.size === 1) {
        const session = ++generation;
        stop = start((next) => {
          if (
            generation !== session ||
            listeners.size === 0 ||
            Object.is(snapshot, next)
          )
            return;
          snapshot = next;
          for (const callback of listeners) callback();
        });
      }
      return () => {
        if (!listeners.delete(notify) || listeners.size !== 0) return;
        generation++;
        stop?.();
        stop = undefined;
        snapshot = initial();
      };
    },
  };
}
