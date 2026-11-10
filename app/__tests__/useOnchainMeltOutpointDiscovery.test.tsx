/**
 * @jest-environment node
 *
 * Characterization of `useOnchainMeltOutpointDiscovery`: which inputs start the
 * address watch, how often it asks mempool.space, which transactions it adopts
 * as the melt's outpoint (and writes as a heuristic annotation), and when it
 * stops. The address lookup and the annotation store are replaced; the
 * matching rule is the wallet package's own.
 */

import { act, renderHook } from '@testing-library/react-native';

import { useOnchainMeltOutpointDiscovery } from '@/shared/hooks/useOnchainMeltOutpointDiscovery';
import { defaultChainAdapter, fetchAddressOutpointCandidates } from 'wallet';
import { setTransactionAnnotation } from '@/shared/stores/profile/transactionAnnotationStore';

const mockAnnotations = new Map<string, { onchainOutpoint?: string }>();

jest.mock('wallet', () => ({
  ...jest.requireActual('wallet'),
  fetchAddressOutpointCandidates: jest.fn(),
}));
jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: jest.fn(),
  transactionAnnotationAdapter: { get: (key: string) => mockAnnotations.get(key) },
}));
jest.mock('@/shared/lib/logger', () => ({
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const ADDRESS = 'bc1qdestination';
const CREATED = 1_700_000_000;
const lookup = jest.mocked(fetchAddressOutpointCandidates);

type Props = Parameters<typeof useOnchainMeltOutpointDiscovery>[0];
const BASE: Props = {
  quoteId: 'q-1',
  address: ADDRESS,
  amountSats: 5_000,
  quoteCreatedAtSec: CREATED,
  enabled: true,
};

function tx(txid: string, outputs: [string, number][], blockTimeSec?: number) {
  return {
    txid,
    confirmed: blockTimeSec != null,
    blockTimeSec,
    vout: outputs.map(([address, valueSats]) => ({ address, valueSats })),
  };
}

function mount(props: Partial<Props> = {}) {
  return renderHook((p: Props) => useOnchainMeltOutpointDiscovery(p), {
    initialProps: { ...BASE, ...props },
  });
}

async function tick(ms = 0) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockAnnotations.clear();
  lookup.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('when the watch runs', () => {
  it('runs against mainnet', () => {
    expect(defaultChainAdapter.network).toBe('mainnet');
  });

  it.each([
    ['disabled', { enabled: false }],
    ['no quote id', { quoteId: null }],
    ['no address', { address: '' }],
    ['no amount', { amountSats: null }],
    ['a zero amount', { amountSats: 0 }],
    ['a non-finite amount', { amountSats: Number.NaN }],
    ['no quote time', { quoteCreatedAtSec: null }],
  ] as const)('never asks mempool.space with %s', async (_label, props) => {
    mount(props);
    await tick(70_000 * 3);

    expect(lookup).not.toHaveBeenCalled();
  });

  it('asks at once and then every 70 s', async () => {
    mount();
    await tick();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(ADDRESS);

    await tick(69_999);
    expect(lookup).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('stops on unmount and when the caller disables it', async () => {
    const first = mount();
    await tick();
    first.unmount();
    await tick(70_000 * 2);
    expect(lookup).toHaveBeenCalledTimes(1);

    lookup.mockClear();
    const second = mount();
    await tick();
    second.rerender({ ...BASE, enabled: false });
    await tick(70_000 * 2);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a failed lookup', async () => {
    lookup.mockRejectedValueOnce(new Error('429'));
    mount();
    await tick();
    await tick(70_000);

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it('skips the lookup while the melt already has an outpoint', async () => {
    mockAnnotations.set('quote:q-1', { onchainOutpoint: 'f'.repeat(64) + ':0' });
    mount();
    await tick(70_000 * 2);

    expect(lookup).not.toHaveBeenCalled();
  });
});

describe('which payment it adopts', () => {
  it('adopts the one output paying the exact amount to the address and stops polling', async () => {
    lookup.mockResolvedValue([
      tx('t1', [
        ['bc1qchange', 9_000],
        [ADDRESS, 5_000],
      ]),
    ]);
    mount();
    await tick();

    expect(setTransactionAnnotation).toHaveBeenCalledTimes(1);
    expect(setTransactionAnnotation).toHaveBeenCalledWith('quote:q-1', {
      onchainMelt: { outpoint: 't1:1', outpointSource: 'heuristic' },
    });
    await tick(70_000 * 3);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('adopts nothing when two outputs match, and keeps looking', async () => {
    lookup.mockResolvedValue([tx('t1', [[ADDRESS, 5_000]]), tx('t2', [[ADDRESS, 5_000]])]);
    mount();
    await tick();
    await tick(70_000);

    expect(setTransactionAnnotation).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('ignores a matching payment confirmed before the quote existed', async () => {
    lookup.mockResolvedValue([
      tx('old', [[ADDRESS, 5_000]], CREATED - 1),
      tx('new', [[ADDRESS, 5_000]], CREATED),
    ]);
    mount();
    await tick();

    expect(setTransactionAnnotation).toHaveBeenCalledWith('quote:q-1', {
      onchainMelt: { outpoint: 'new:0', outpointSource: 'heuristic' },
    });
  });

  it('ignores a different amount or address', async () => {
    lookup.mockResolvedValue([tx('t1', [[ADDRESS, 4_999]]), tx('t2', [['bc1qother', 5_000]])]);
    mount();
    await tick();

    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it('does not overwrite an outpoint that arrived while the lookup was out', async () => {
    let answer!: (txs: ReturnType<typeof tx>[]) => void;
    lookup.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve as typeof answer;
      }) as never
    );
    mount();
    await tick();
    mockAnnotations.set('quote:q-1', { onchainOutpoint: 'mint:0' });

    answer([tx('t1', [[ADDRESS, 5_000]])]);
    await tick();

    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });

  it('drops a lookup that answers after unmount', async () => {
    let answer!: (txs: ReturnType<typeof tx>[]) => void;
    lookup.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve as typeof answer;
      }) as never
    );
    const { unmount } = mount();
    await tick();
    unmount();

    answer([tx('t1', [[ADDRESS, 5_000]])]);
    await tick();

    expect(setTransactionAnnotation).not.toHaveBeenCalled();
  });
});
