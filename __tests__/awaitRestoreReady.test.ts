import { awaitRestoreReady, type RestoreReadyStatus } from '@/shared/providers/awaitRestoreReady';

type Listener = (
  state: { restoreStatus: RestoreReadyStatus },
  prev: { restoreStatus: RestoreReadyStatus }
) => void;

function makeFakeStore(initial: RestoreReadyStatus) {
  let current: RestoreReadyStatus = initial;
  const listeners = new Set<Listener>();
  return {
    getState: () => ({ restoreStatus: current }),
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setState(next: RestoreReadyStatus) {
      const prev = current;
      current = next;
      listeners.forEach((l) => l({ restoreStatus: current }, { restoreStatus: prev }));
    },
    listenerCount: () => listeners.size,
  };
}

describe('awaitRestoreReady (audit 28.json F-004 / 40.json F-003)', () => {
  it('resolves immediately when status is already complete', async () => {
    const store = makeFakeStore('complete');
    await expect(awaitRestoreReady(store)).resolves.toBeUndefined();
    expect(store.listenerCount()).toBe(0);
  });

  it('resolves immediately when status is already not-needed', async () => {
    const store = makeFakeStore('not-needed');
    await expect(awaitRestoreReady(store)).resolves.toBeUndefined();
    expect(store.listenerCount()).toBe(0);
  });

  it('waits for a future transition to complete', async () => {
    const store = makeFakeStore('in-progress');
    const promise = awaitRestoreReady(store);
    expect(store.listenerCount()).toBe(1);
    store.setState('complete');
    await expect(promise).resolves.toBeUndefined();
    expect(store.listenerCount()).toBe(0);
  });

  it('does not resolve while status remains non-ready', async () => {
    const store = makeFakeStore('unknown');
    let resolved = false;
    const promise = awaitRestoreReady(store).then(() => {
      resolved = true;
    });
    store.setState('pending');
    store.setState('in-progress');
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    store.setState('not-needed');
    await promise;
    expect(resolved).toBe(true);
  });

  it('does not hang when state flips ready between subscribe and the post-subscribe check', async () => {
    // Simulates the TOCTOU window: a fake store that flips on the first
    // subscribe() call so that getState() afterwards already reads 'complete'.
    // The previous implementation registered a "next change" listener and
    // then read the current state; it would observe 'complete' but skip
    // resolving, then never see another change.
    const store = makeFakeStore('in-progress');
    const realSubscribe = store.subscribe;
    store.subscribe = (l) => {
      const unsub = realSubscribe(l);
      // Race: state flips after the subscriber is in place but before our
      // post-subscribe getState() call. The new implementation must still
      // resolve via the post-subscribe check.
      store.setState('complete');
      return unsub;
    };
    await expect(awaitRestoreReady(store)).resolves.toBeUndefined();
  });

  it('resolves when persist hydration setState fires after subscribe is registered', async () => {
    // Simulates the pre-hydration case (28.json F-004): initial in-memory
    // value is 'unknown'; persist middleware later hydrates with 'complete'
    // by calling setState. The subscriber registered before that setState
    // catches the change.
    const store = makeFakeStore('unknown');
    const promise = awaitRestoreReady(store);
    queueMicrotask(() => store.setState('complete'));
    await expect(promise).resolves.toBeUndefined();
  });
});
