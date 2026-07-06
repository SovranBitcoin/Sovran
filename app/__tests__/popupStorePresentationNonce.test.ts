/**
 * Regression for the dead-Next repro (receive fixed-amount back-navigation).
 *
 * PopupHost presents on `openSeq` changes, not on `isOpen` edges alone: a
 * native sheet teardown that bypasses close() (route navigation ripping the
 * FullWindowOverlay, heroui's measure/snap race) leaves `isOpen` stuck true,
 * and an edge-triggered host renders every later open() a silent no-op — the
 * captured device log showed five Next presses logging `store.popup.open`
 * with no sheet ever presented. The nonce must therefore bump on EVERY
 * open(), including opens issued while the store already believes a sheet
 * is up.
 */

import { usePopupStore } from '@/shared/stores/runtime/popupStore';

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
    storeLog: stub,
    log: stub,
    createLogger: () => stub,
    redactError: (e: unknown) => e,
  };
});

function resetStore() {
  usePopupStore.setState({ current: null, isOpen: false, destroyed: false });
}

describe('popupStore presentation nonce', () => {
  beforeEach(resetStore);

  it('bumps openSeq on every open(), even when isOpen is stuck true', () => {
    const seq0 = usePopupStore.getState().openSeq;

    usePopupStore.getState().open({ message: 'first' });
    const seq1 = usePopupStore.getState().openSeq;
    expect(seq1).toBe(seq0 + 1);
    expect(usePopupStore.getState().isOpen).toBe(true);

    // Native teardown bypassed close(): isOpen stays true. The next open()
    // must still produce a fresh presentation signal.
    usePopupStore.getState().open({ message: 'second' });
    const seq2 = usePopupStore.getState().openSeq;
    expect(seq2).toBe(seq1 + 1);
    expect(usePopupStore.getState().isOpen).toBe(true);
  });

  it('close() and destroySheet() do not consume nonce values', () => {
    usePopupStore.getState().open({ message: 'first' });
    const seqAfterOpen = usePopupStore.getState().openSeq;

    usePopupStore.getState().close();
    expect(usePopupStore.getState().openSeq).toBe(seqAfterOpen);
    expect(usePopupStore.getState().isOpen).toBe(false);

    usePopupStore.getState().open({ message: 'second' });
    usePopupStore.getState().destroySheet();
    expect(usePopupStore.getState().openSeq).toBe(seqAfterOpen + 1);
  });

  it('still fires the replaced onClose exactly once when opening over an open sheet', () => {
    const onClose = jest.fn();
    usePopupStore.getState().open({ message: 'first', onClose });
    usePopupStore.getState().open({ message: 'second' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith({ reason: 'replaced' });
  });
});
