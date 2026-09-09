import { describe, expect, test, vi } from 'vitest';
import { combineSignals } from '../src/timeout';

describe('combined request cancellation', () => {
  test('removes listeners from every source when one source aborts', () => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const removeCaller = vi.spyOn(caller.signal, 'removeEventListener');
    const removeDeadline = vi.spyOn(deadline.signal, 'removeEventListener');
    const signal = combineSignals(caller.signal, deadline.signal);
    const onAbort = vi.fn();
    signal.addEventListener('abort', onAbort);
    const reason = new Error('deadline');
    deadline.abort(reason);
    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe(reason);
    expect(removeCaller).toHaveBeenCalledTimes(1);
    expect(removeDeadline).toHaveBeenCalledTimes(1);
    caller.abort();
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  test('an already cancelled source leaves no listener on earlier sources', () => {
    const caller = new AbortController();
    const closed = new AbortController();
    closed.abort();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    expect(combineSignals(caller.signal, undefined, closed.signal).aborted).toBe(true);
    expect(add.mock.calls.length - remove.mock.calls.length).toBe(0);
  });
});
