/**
 * @jest-environment node
 *
 * The swap's toast (`useSwapStatusListener`): one toast for the whole run that
 * follows the step it is on and then its result, driven from the swap status
 * store through the payment toast machine.
 *
 * Also the regressions of audit 36 F-002 / F-004: a toast dismissed mid-run
 * must not clear the swap store (the gate against a second mint/melt), and the
 * run's result must still get a toast.
 */

import { act, renderHook } from '@testing-library/react-native';

import { swapToast, useSwapStatusListener } from '@/shared/hooks/useSwapStatusListener';
import { TOAST_TIMING } from '@/shared/lib/popup/paymentToastMachine';
import { paymentToasts, usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { isSwapStatusActive, useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';

jest.mock('@/shared/lib/logger', () => {
  const logger = { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() };
  return { paymentLog: logger, storeLog: logger, log: { ...logger, child: () => logger } };
});

const { spinnerDelayMs, minVisibleMs, resultMs, closeAfterMs } = TOAST_TIMING;

const swap = () => useSwapStatusStore.getState();
const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

/** What the swap toast shows now, as `phase · title · subtitle`; null when off screen. */
function shown(): string | null {
  const toast = usePaymentStatusStore.getState().toasts.find((t) => t.key.startsWith('swap:'));
  if (!toast || toast.content.kind !== 'steps') return null;
  return [toast.phase, toast.content.title, toast.content.subtitle ?? '-'].join(' · ');
}

function start(legs = 2) {
  act(() =>
    swap().start({
      id: 'swap-1',
      legs: Array.from({ length: legs }, (_, i) => ({
        id: `leg-${i + 1}`,
        label: `Step ${i + 1}`,
      })),
      meta: { unit: 'sat', groupId: 'group-1' },
    })
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  paymentToasts.dismissAll();
  useSwapStatusStore.setState({ active: null });
});

afterEach(() => {
  paymentToasts.dismissAll();
  jest.useRealTimers();
});

describe('the swap toast', () => {
  it('shows the step the run is on, never a count of steps', () => {
    const { unmount } = renderHook(() => useSwapStatusListener());
    start();
    act(() => swap().setActiveLeg('leg-1'));
    advance(spinnerDelayMs);
    expect(shown()).toBe('working · Swapping · Step 1');

    advance(60_000);
    act(() => {
      swap().setLegDone('leg-1');
      swap().setActiveLeg('leg-2');
    });
    advance(spinnerDelayMs);
    expect(shown()).toBe('working · Swapping · Step 2');
    expect(shown()).not.toMatch(/\d of \d/);
    unmount();
  });

  it('goes from a long step straight to the result when the last step is instant', () => {
    const { unmount } = renderHook(() => useSwapStatusListener());
    const seen: (string | null)[] = [];
    const off = usePaymentStatusStore.subscribe(() => seen.push(shown()));
    start();
    act(() => swap().setActiveLeg('leg-1'));
    advance(spinnerDelayMs + 60_000);

    act(() => {
      swap().setLegDone('leg-1');
      swap().setActiveLeg('leg-2');
    });
    advance(40);
    act(() => {
      swap().setLegDone('leg-2');
      swap().complete();
    });
    advance(minVisibleMs);

    expect(shown()).toBe('done · Swap complete · -');
    // The instant second step was never drawn, and the first never came back.
    expect([...new Set(seen)]).toEqual(['working · Swapping · Step 1', 'done · Swap complete · -']);
    off();
    unmount();
  });

  it('opens the swap’s group from its toast', () => {
    start();
    expect(swapToast(swap().active!).content).toMatchObject({ kind: 'steps', groupId: 'group-1' });
  });

  it('keeps the store, and the gate, when the toast is dismissed mid-run (F-002)', () => {
    const { unmount } = renderHook(() => useSwapStatusListener());
    start();
    advance(spinnerDelayMs);
    const toast = usePaymentStatusStore.getState().toasts[0]!;

    act(() => paymentToasts.userDismissed(toast.id));

    expect(shown()).toBeNull();
    expect(swap().active?.state).toBe('running');
    expect(isSwapStatusActive()).toBe(true);
    unmount();
  });

  it.each([
    ['complete', () => swap().complete(), 'done · Swap complete · -'],
    ['fail', () => swap().fail('No route'), 'failed · Swap failed · No route'],
    ['cancel', () => swap().cancel('Stopped'), 'failed · Swap cancelled · Stopped'],
  ] as const)(
    'still tells the result after a mid-run dismissal: %s (F-004)',
    (_, end, expected) => {
      const { unmount } = renderHook(() => useSwapStatusListener());
      start();
      advance(spinnerDelayMs);
      act(() => paymentToasts.userDismissed(usePaymentStatusStore.getState().toasts[0]!.id));

      act(() => void end());
      expect(shown()).toBe(expected);

      // Once the result toast leaves, the run is finished with and the store clears.
      advance(resultMs);
      expect(shown()).toBeNull();
      expect(swap().active).toBeNull();
      unmount();
    }
  );

  it('says an unsettled run is still settling, not that it failed, then closes and clears', () => {
    const { unmount } = renderHook(() => useSwapStatusListener());
    start();
    advance(spinnerDelayMs + minVisibleMs);
    act(() => swap().settleUnknown('A payment is still in flight'));
    expect(shown()).toBe('slow · Swap still settling · A payment is still in flight');
    advance(closeAfterMs);
    expect(shown()).toBeNull();
    expect(swap().active).toBeNull();
    unmount();
  });

  it('spins again when a run that ended is reopened for a retry', () => {
    const { unmount } = renderHook(() => useSwapStatusListener());
    start();
    advance(spinnerDelayMs + minVisibleMs);
    act(() => swap().fail('No route'));
    expect(shown()).toBe('failed · Swap failed · No route');

    act(() => swap().resume());
    advance(spinnerDelayMs + minVisibleMs);
    expect(shown()).toMatch(/^working · Swapping/);
    expect(swap().active?.state).toBe('running');
    unmount();
  });

  it('takes its toast down when the store is cleared from elsewhere', () => {
    const { unmount } = renderHook(() => useSwapStatusListener());
    start();
    advance(spinnerDelayMs);
    expect(shown()).not.toBeNull();
    act(() => swap().clear());
    expect(shown()).toBeNull();
    advance(60_000);
    expect(shown()).toBeNull();
    unmount();
  });
});
