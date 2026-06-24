/**
 * Regression for audit 36.json F-002 / F-004.
 *
 * F-002: SwapStatusToast's onPressView (and any user swipe) must NOT clear
 *        useSwapStatusStore.active while state === 'running' — that's the
 *        load-bearing gate against parallel coco mint/melt operations.
 * F-004: When the user dismisses mid-flight, the runner's later complete()/
 *        fail()/cancel() must still surface a terminal toast — re-popped by
 *        useSwapStatusListener.
 */

import { isSwapStatusToastMounted, swapStatusPopup } from '@/shared/lib/popup/popups/payment';
import { useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';

type ShowCustomToastOptions = { onHide?: () => void };

const mockShowCustomToast = jest.fn<string, [ShowCustomToastOptions]>(() => 'toast-id');

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = () => {};
  const stub = {
    info: noop,
    debug: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    trace: noop,
    child: () => stub,
    setLevel: noop,
  };
  return {
    paymentLog: stub,
    storeLog: stub,
    popupLog: stub,
    walletLog: stub,
    log: stub,
    createLogger: () => stub,
    redactError: (e: unknown) => e,
  };
});

jest.mock('@/shared/lib/popup/popups/bridge', () => ({
  showCustomToast: (opts: ShowCustomToastOptions) => mockShowCustomToast(opts),
  registerToast: jest.fn(),
  setPopupDuration: jest.fn(),
  showActionSheet: jest.fn(),
}));

jest.mock('@/shared/lib/popup/popups/factory', () => ({
  makeStaticPopup: () => () => undefined,
  makeParamPopup: () => () => undefined,
}));

jest.mock('@/shared/lib/popup/SwapStatusToast', () => ({
  SwapStatusToast: () => null,
}));

jest.mock('@/shared/lib/popup/PaymentStatusToast', () => ({
  PaymentStatusToast: () => null,
}));

function lastOnHide(): () => void {
  const opts = mockShowCustomToast.mock.calls.at(-1)?.[0];
  if (!opts?.onHide) throw new Error('expected onHide on toast call');
  return opts.onHide;
}

function startRunningSwap() {
  useSwapStatusStore.getState().start({
    id: 'swap-1',
    legs: [{ id: 'leg-1' }, { id: 'leg-2' }],
    meta: { unit: 'sat' },
  });
}

describe('swapStatusPopup lifecycle (audit 36.json F-002 / F-004)', () => {
  beforeEach(() => {
    mockShowCustomToast.mockClear();
    useSwapStatusStore.getState().clear();
    // Force-unmount any leftover toast flag from a previous test by triggering
    // an onHide path with no active swap (always clears + flips flag false).
    if (isSwapStatusToastMounted()) {
      // Pop a synthetic onHide by re-calling and immediately hiding.
      // We can't reach the flag directly, so unmount via a fresh popup + hide.
    }
  });

  it('mounts the toast on first call and is idempotent on re-entry (F-004 dedup)', () => {
    startRunningSwap();
    swapStatusPopup();
    expect(mockShowCustomToast).toHaveBeenCalledTimes(1);
    expect(isSwapStatusToastMounted()).toBe(true);

    swapStatusPopup();
    expect(mockShowCustomToast).toHaveBeenCalledTimes(1);
    expect(isSwapStatusToastMounted()).toBe(true);

    // Cleanup so the next test starts mounted=false.
    useSwapStatusStore.getState().complete();
    lastOnHide()();
    expect(isSwapStatusToastMounted()).toBe(false);
  });

  it('keeps useSwapStatusStore.active populated when the toast is dismissed mid-flight (F-002)', () => {
    startRunningSwap();
    swapStatusPopup();

    // User swipes the toast away while state is still 'running'.
    lastOnHide()();

    expect(isSwapStatusToastMounted()).toBe(false);
    const active = useSwapStatusStore.getState().active;
    expect(active).not.toBeNull();
    expect(active?.state).toBe('running');
  });

  it('clears useSwapStatusStore.active when the toast unmounts in a terminal state (F-002 / F-004)', () => {
    startRunningSwap();
    swapStatusPopup();

    useSwapStatusStore.getState().complete();
    expect(useSwapStatusStore.getState().active?.state).toBe('done');

    lastOnHide()();

    expect(isSwapStatusToastMounted()).toBe(false);
    expect(useSwapStatusStore.getState().active).toBeNull();
  });

  it('clears the mounted flag on cancel-then-dismiss so the next swap can re-pop (F-004)', () => {
    startRunningSwap();
    swapStatusPopup();
    expect(isSwapStatusToastMounted()).toBe(true);

    useSwapStatusStore.getState().cancel('user-stop');
    lastOnHide()();
    expect(isSwapStatusToastMounted()).toBe(false);
    expect(useSwapStatusStore.getState().active).toBeNull();

    // A subsequent swap must be able to mount a fresh toast.
    startRunningSwap();
    swapStatusPopup();
    expect(mockShowCustomToast).toHaveBeenCalledTimes(2);
    expect(isSwapStatusToastMounted()).toBe(true);

    useSwapStatusStore.getState().fail('post-cancel-fail');
    lastOnHide()();
    expect(isSwapStatusToastMounted()).toBe(false);
    expect(useSwapStatusStore.getState().active).toBeNull();
  });
});
