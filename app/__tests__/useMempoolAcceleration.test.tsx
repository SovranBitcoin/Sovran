/**
 * @jest-environment node
 *
 * Characterization of `useMempoolAcceleration`: for each input (enabled, txid,
 * quote id, already accelerated) what it fetches from mempool.space, the offer
 * and acceleration flag it returns, when it polls the public status after an
 * invoice is made, when that polling stops, and the annotation it writes. The
 * mempool.space calls and the annotation store are replaced; the offer
 * arithmetic and the status vocabulary are the wallet package's own.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useMempoolAcceleration } from '@/shared/hooks/useMempoolAcceleration';
import {
  createAccelerationInvoice,
  fetchAccelerationEstimate,
  fetchAccelerationStatus,
  fetchAverageBlockTimeMinutes,
  type AccelerationEstimate,
} from 'wallet';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  fetchAccelerationEstimate: jest.fn(),
  fetchAccelerationStatus: jest.fn(),
  fetchAverageBlockTimeMinutes: jest.fn(),
  createAccelerationInvoice: jest.fn(),
}));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const TXID = 'a'.repeat(64);
const OTHER_TXID = 'b'.repeat(64);
const ESTIMATE = {
  txSummary: {},
  cost: 900,
  mempoolBaseFee: 50,
  vsizeFee: 7,
  options: [{ fee: 500 }, { fee: 1_000 }, { fee: 2_000 }],
} as unknown as AccelerationEstimate;

const estimate = jest.mocked(fetchAccelerationEstimate);
const status = jest.mocked(fetchAccelerationStatus);
const eta = jest.mocked(fetchAverageBlockTimeMinutes);
const invoice = jest.mocked(createAccelerationInvoice);

type Props = Parameters<typeof useMempoolAcceleration>[0];

function mount(props: Partial<Props> = {}) {
  return renderHook((p: Props) => useMempoolAcceleration(p), {
    initialProps: {
      txid: TXID,
      quoteId: 'q-1',
      alreadyAccelerated: false,
      enabled: true,
      ...props,
    },
  });
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  estimate.mockResolvedValue(ESTIMATE);
  status.mockResolvedValue(null);
  eta.mockResolvedValue(10);
  invoice.mockResolvedValue({ invoiceId: 'i-1', bolt11: 'lnbc1accel', expiresAtSec: 1 });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the offer on mount', () => {
  it.each([
    ['disabled', { enabled: false }],
    ['without a txid', { txid: null }],
    ['already accelerated', { alreadyAccelerated: true }],
  ] as const)('fetches nothing when %s', async (_label, props) => {
    const { result } = mount(props);
    await flush();

    expect(estimate).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(result.current.offer).toBeNull();
  });

  it('reports a transaction already marked accelerated as accelerating, only while enabled', async () => {
    const { result, rerender } = mount({ alreadyAccelerated: true });
    await flush();
    expect(result.current.accelerating).toBe(true);

    rerender({ txid: TXID, quoteId: 'q-1', alreadyAccelerated: true, enabled: false });
    expect(result.current.accelerating).toBe(false);
  });

  it('offers the middle bid with the service fees added and the block-time ETA', async () => {
    const { result } = mount();
    await flush();

    expect(estimate).toHaveBeenCalledWith(TXID);
    expect(status).toHaveBeenCalledWith(TXID);
    expect(result.current.offer).toEqual({ bidSats: 1_000, totalSats: 1_057, etaMinutes: 10 });
    expect(result.current.accelerating).toBe(false);
  });

  it('offers nothing for a transaction mempool.space will not accelerate, or when the fetch fails', async () => {
    estimate.mockResolvedValueOnce(null);
    const first = mount();
    await flush();
    expect(first.result.current.offer).toBeNull();

    estimate.mockRejectedValueOnce(new Error('offline'));
    const second = mount();
    await flush();
    expect(second.result.current.offer).toBeNull();
    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it('marks an acceleration mempool.space already acknowledges and saves it on the melt', async () => {
    status.mockResolvedValueOnce({ txid: TXID, status: 'Accelerating' });
    const { result } = mount();
    await flush();

    expect(result.current.accelerating).toBe(true);
    expect(result.current.offer).toBeNull();
    expect(setTransactionAnnotation).toHaveBeenCalledWith('quote:q-1', {
      onchainMelt: { accelerated: true },
    });
  });

  it('marks it without saving anything when there is no quote id', async () => {
    status.mockResolvedValueOnce({ txid: TXID, status: 'mined' });
    const { result } = mount({ quoteId: null });
    await flush();

    expect(result.current.accelerating).toBe(true);
    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it('drops the old offer when the txid changes', async () => {
    const { result, rerender } = mount();
    await flush();
    expect(result.current.offer).not.toBeNull();
    estimate.mockReturnValueOnce(new Promise(() => undefined));

    rerender({ txid: OTHER_TXID, quoteId: 'q-1', alreadyAccelerated: false, enabled: true });

    expect(result.current.offer).toBeNull();
  });
});

describe('the invoice and the status poll', () => {
  it('returns no invoice before there is an offer', async () => {
    estimate.mockResolvedValueOnce(null);
    const { result } = mount();
    await flush();

    await expect(result.current.requestInvoice()).resolves.toBeNull();
    expect(invoice).not.toHaveBeenCalled();
  });

  it('asks for one invoice for the offered bid even when requested twice at once', async () => {
    const { result } = mount();
    await flush();

    let both: (string | null)[] = [];
    await act(async () => {
      both = await Promise.all([result.current.requestInvoice(), result.current.requestInvoice()]);
    });

    expect(both).toEqual(['lnbc1accel', 'lnbc1accel']);
    expect(invoice).toHaveBeenCalledTimes(1);
    expect(invoice).toHaveBeenCalledWith(TXID, 1_000);
  });

  it('polls every 15 s after the invoice until mempool.space acknowledges, then stops', async () => {
    const { result } = mount();
    await flush();
    await act(async () => {
      await result.current.requestInvoice();
    });
    status.mockClear();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
    });
    expect(status).toHaveBeenCalledTimes(1);
    expect(result.current.accelerating).toBe(false);

    status.mockResolvedValueOnce({ txid: TXID, status: 'accelerating' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.accelerating).toBe(true);
    expect(setTransactionAnnotation).toHaveBeenCalledWith('quote:q-1', {
      onchainMelt: { accelerated: true },
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('gives up polling after five minutes without an acknowledgement', async () => {
    const { result } = mount();
    await flush();
    await act(async () => {
      await result.current.requestInvoice();
    });
    status.mockClear();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10 * 60_000);
    });

    // Twenty checks inside the five minutes; the tick past the deadline stops the poll.
    expect(status).toHaveBeenCalledTimes(20);
    expect(result.current.accelerating).toBe(false);
  });

  it('stops polling on unmount', async () => {
    const { result, unmount } = mount();
    await flush();
    await act(async () => {
      await result.current.requestInvoice();
    });
    status.mockClear();

    unmount();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(status).not.toHaveBeenCalled();
  });

  it('starts no poll when the screen closes before the invoice comes back', async () => {
    let finishInvoice!: (value: Awaited<ReturnType<typeof createAccelerationInvoice>>) => void;
    invoice.mockReturnValueOnce(
      new Promise((done) => {
        finishInvoice = done;
      })
    );
    const { result, unmount } = mount();
    await flush();
    let pending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      pending = result.current.requestInvoice();
    });
    status.mockClear();

    unmount();
    await act(async () => {
      finishInvoice({ invoiceId: 'i-1', bolt11: 'lnbc1accel', expiresAtSec: 1 });
      await pending;
    });
    status.mockResolvedValue({ txid: TXID, status: 'accelerating' });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(status).not.toHaveBeenCalled();
    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it("keeps the new transaction's poll when the old transaction's invoice comes back late", async () => {
    let finishOldInvoice!: (value: Awaited<ReturnType<typeof createAccelerationInvoice>>) => void;
    invoice.mockReturnValueOnce(
      new Promise((done) => {
        finishOldInvoice = done;
      })
    );
    const { result, rerender } = mount();
    await flush();
    let oldPending: Promise<string | null> = Promise.resolve(null);
    act(() => {
      oldPending = result.current.requestInvoice();
    });

    rerender({ txid: OTHER_TXID, quoteId: 'q-1', alreadyAccelerated: false, enabled: true });
    await flush();
    await act(async () => {
      await result.current.requestInvoice();
    });
    await act(async () => {
      finishOldInvoice({ invoiceId: 'i-old', bolt11: 'lnbc1old', expiresAtSec: 1 });
      await oldPending;
    });
    status.mockClear();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_000);
    });

    expect(status.mock.calls).toEqual([[OTHER_TXID], [OTHER_TXID]]);
  });

  it('saves no acknowledgement that arrives after the screen closed', async () => {
    const { result, unmount } = mount();
    await flush();
    await act(async () => {
      await result.current.requestInvoice();
    });
    let finishStatus!: (value: Awaited<ReturnType<typeof fetchAccelerationStatus>>) => void;
    status.mockReturnValueOnce(
      new Promise((done) => {
        finishStatus = done;
      })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(15_000);
    });

    unmount();
    await act(async () => {
      finishStatus({ txid: TXID, status: 'accelerating' });
    });
    await flush();

    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it('starts no poll when no invoice comes back or creating it fails', async () => {
    const { result } = mount();
    await flush();
    invoice.mockResolvedValueOnce(null);
    await act(async () => {
      await expect(result.current.requestInvoice()).resolves.toBeNull();
    });
    invoice.mockRejectedValueOnce(new Error('503'));
    await act(async () => {
      await expect(result.current.requestInvoice()).resolves.toBeNull();
    });
    status.mockClear();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(status).not.toHaveBeenCalled();
  });
});
