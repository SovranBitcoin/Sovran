import { reconcileToggle, type ReconcileToggleDeps } from '@/features/feed/lib/engagementToggle';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (e: unknown) => void;
};
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function harness(initialOwnEventId: string | undefined, initialIntent: boolean | undefined) {
  let intent = initialIntent;
  const calls: string[] = [];
  const activations: Deferred<string>[] = [];
  const retractions: Deferred<void>[] = [];
  const deps: ReconcileToggleDeps = {
    initialOwnEventId,
    readIntent: () => intent,
    activate: () => {
      calls.push('activate');
      const d = deferred<string>();
      activations.push(d);
      return d.promise;
    },
    deactivate: (id) => {
      calls.push(`deactivate:${id}`);
      const d = deferred<void>();
      retractions.push(d);
      return d.promise;
    },
    onProgress: (id) => calls.push(`progress:${id ?? 'none'}`),
    onSettled: () => calls.push('settled'),
    onFailed: (id, error) => calls.push(`failed:${id ?? 'none'}:${String(error)}`),
  };
  return {
    deps,
    calls,
    activations,
    retractions,
    setIntent: (next: boolean | undefined) => {
      intent = next;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

it('publishes a like and settles', async () => {
  const h = harness(undefined, true);
  const run = reconcileToggle(h.deps);
  h.activations[0].resolve('like-1');
  await run;
  expect(h.calls).toEqual(['activate', 'progress:like-1', 'settled']);
});

it('lets an unlike made during the like publish retract it', async () => {
  const h = harness(undefined, true);
  const run = reconcileToggle(h.deps);
  h.setIntent(false); // tapped again while the like is in flight
  h.activations[0].resolve('like-1');
  await flush();
  expect(h.calls).toEqual(['activate', 'progress:like-1', 'deactivate:like-1']);
  h.retractions[0].resolve();
  await run;
  expect(h.calls).toEqual([
    'activate',
    'progress:like-1',
    'deactivate:like-1',
    'progress:none',
    'settled',
  ]);
});

it('collapses like → unlike → like during one publish into a single like', async () => {
  const h = harness(undefined, true);
  const run = reconcileToggle(h.deps);
  h.setIntent(false);
  h.setIntent(true);
  h.activations[0].resolve('like-1');
  await run;
  expect(h.calls).toEqual(['activate', 'progress:like-1', 'settled']);
});

it('retracts an existing like', async () => {
  const h = harness('like-0', false);
  const run = reconcileToggle(h.deps);
  h.retractions[0].resolve();
  await run;
  expect(h.calls).toEqual(['deactivate:like-0', 'progress:none', 'settled']);
});

it('does nothing when the network already matches, or the intent is gone', async () => {
  const matches = harness('like-0', true);
  await reconcileToggle(matches.deps);
  expect(matches.calls).toEqual(['settled']);

  const cleared = harness(undefined, undefined);
  await reconcileToggle(cleared.deps);
  expect(cleared.calls).toEqual(['settled']);
});

it('reports the last confirmed network state when a step fails', async () => {
  const h = harness(undefined, true);
  const run = reconcileToggle(h.deps);
  h.setIntent(false);
  h.activations[0].resolve('like-1');
  await flush();
  h.retractions[0].reject('relay down');
  await run;
  expect(h.calls).toEqual([
    'activate',
    'progress:like-1',
    'deactivate:like-1',
    'failed:like-1:relay down',
  ]);
});
