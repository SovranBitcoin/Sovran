/** @jest-environment node */
import { hasPresentedRoutes, joinOrStart } from '@/shared/lib/profile/suspendHelpers';

/**
 * Used when the account tree is unmounted for a switch or a hold: sheets are
 * closed first, but only when one is open, and overlapping requests to unmount
 * share one run.
 */
describe('hasPresentedRoutes', () => {
  const tabs = { type: 'tab', index: 0, routes: [{ name: 'index' }, { name: 'feed' }] };
  const drawer = (inner: unknown) => ({
    type: 'drawer',
    index: 0,
    routes: [{ name: '(tabs)', state: inner }],
  });

  it('is false at rest: one root route, tabs side by side', () => {
    const root = { type: 'stack', index: 0, routes: [{ name: '(drawer)', state: drawer(tabs) }] };
    expect(hasPresentedRoutes(root)).toBe(false);
  });

  it('is true for a sheet on the root stack', () => {
    const root = {
      type: 'stack',
      index: 1,
      routes: [{ name: '(drawer)', state: drawer(tabs) }, { name: '(prompt-flow)' }],
    };
    expect(hasPresentedRoutes(root)).toBe(true);
  });

  it('is true for a sheet held by a nested stack', () => {
    const nested = { type: 'stack', index: 1, routes: [{ name: 'index' }, { name: 'receive' }] };
    const root = { type: 'stack', index: 0, routes: [{ name: '(drawer)', state: drawer(nested) }] };
    expect(hasPresentedRoutes(root)).toBe(true);
  });

  it('is false for a state it cannot read', () => {
    expect(hasPresentedRoutes(undefined)).toBe(false);
    expect(hasPresentedRoutes({ routes: 'nope' })).toBe(false);
  });
});

describe('joinOrStart', () => {
  it('runs once for overlapping callers, then again for a later one', async () => {
    const slot: { current: Promise<void> | null } = { current: null };
    let finish!: () => void;
    const start = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );

    const first = joinOrStart(slot, start);
    const second = joinOrStart(slot, start);
    expect(start).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);

    finish();
    await first;
    expect(slot.current).toBeNull();

    const third = joinOrStart(slot, start);
    expect(start).toHaveBeenCalledTimes(2);
    finish();
    await third;
  });

  it('frees the slot when the run fails', async () => {
    const slot: { current: Promise<void> | null } = { current: null };

    await expect(joinOrStart(slot, () => Promise.reject(new Error('no')))).rejects.toThrow('no');

    expect(slot.current).toBeNull();
  });
});
