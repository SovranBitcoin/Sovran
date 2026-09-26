import { sendMessage, setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';
import {
  RESPONSE_IDLE_DEADLINE_MS,
  RESPONSE_START_DEADLINE_MS,
} from '@/shared/lib/routstr/requestDeadline';

const mockRoute = jest.fn<Promise<Response>, [{ signal?: AbortSignal }]>();
jest.mock('@/shared/lib/routstr/sdk/client', () => ({
  getRoutstrClient: async () => ({
    client: { routeRequest: mockRoute },
    baseUrl: 'https://node.example/',
    payment: () => ({
      mintedSats: null,
      mintedFromHost: undefined,
      changeSats: null,
      changeReceived: false,
      changeFailed: false,
    }),
    finish: async () => {},
    refusal: () => null,
    settleWithoutChange: jest.fn(),
  }),
  acceptedMintsForProvider: async () => null,
  sweepUnsettledPayments: jest.fn(async () => {}),
}));
jest.mock('@/shared/lib/routstr/sdk/walletAdapter', () => ({
  cocoWalletAdapter: { getBalances: async () => ({ 'https://mint.example': 100 }) },
}));
jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ selectedMint: 'https://mint.example' }) },
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: { getState: () => ({ activeAccountIndex: 0 }) },
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { apiLog: log, aiLog: log, storeLog: log, log, applyFileLogging: jest.fn() };
});

describe('Routstr response deadlines', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRoute.mockReset();
    setRoutstrNodeBaseUrl('https://node.example');
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases a connection that never returns, even when transport ignores cancellation', async () => {
    mockRoute.mockImplementation(() => new Promise(() => {}));
    let failure: unknown;
    const pending = sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' }).catch(
      (error) => {
        failure = error;
      }
    );
    await jest.advanceTimersByTimeAsync(RESPONSE_START_DEADLINE_MS + 1);
    expect(failure).toMatchObject({ error: { code: 'timeout' } });
    expect(mockRoute.mock.calls[0][0].signal?.aborted).toBe(true);
    await pending;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts silence after a response begins and rejects its unsettled cost', async () => {
    const body = new ReadableStream<Uint8Array>();
    mockRoute.mockResolvedValue(
      Object.assign(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), {
        finalize: () => new Promise<number>(() => {}),
      })
    );
    const { stream, cost } = await sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' });
    let streamError: unknown;
    let costError: unknown;
    const reading = (async () => {
      for await (const _chunk of stream) {
        /* no chunks */
      }
    })().catch((error) => {
      streamError = error;
    });
    const costing = cost.catch((error) => {
      costError = error;
    });
    await jest.advanceTimersByTimeAsync(RESPONSE_IDLE_DEADLINE_MS + 1);
    expect(streamError).toMatchObject({ name: 'TimeoutError' });
    expect(costError).toMatchObject({ name: 'TimeoutError' });
    expect(mockRoute.mock.calls[0][0].signal?.aborted).toBe(true);
    await Promise.all([reading, costing]);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('allows a long response while chunks keep arriving', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let finish!: (cost: number) => void;
    const finalCost = new Promise<number>((resolve) => {
      finish = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    mockRoute.mockResolvedValue(
      Object.assign(new Response(body, { headers: { 'content-type': 'text/event-stream' } }), {
        finalize: () => finalCost,
      })
    );
    const { stream, cost } = await sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' });
    let chunks = 0;
    const reading = (async () => {
      for await (const _chunk of stream) chunks++;
    })();
    for (let index = 0; index < 4; index++) {
      await jest.advanceTimersByTimeAsync(45_000);
      controller.enqueue(
        new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')
      );
      await jest.advanceTimersByTimeAsync(0);
    }
    controller.close();
    finish(1);
    await reading;
    await expect(cost).resolves.toBe(1);
    expect(chunks).toBe(4);
    expect(mockRoute.mock.calls[0][0].signal?.aborted).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('keeps the stream deadline after the SDK cost settles early', async () => {
    mockRoute.mockResolvedValue(
      Object.assign(
        new Response(new ReadableStream<Uint8Array>(), {
          headers: { 'content-type': 'text/event-stream' },
        }),
        { finalize: async () => 1 }
      )
    );
    const { stream, cost } = await sendMessage([{ role: 'user', content: 'hi' }], { model: 'm' });
    await expect(cost).resolves.toBe(1);
    let failure: unknown;
    const reading = stream[Symbol.asyncIterator]()
      .next()
      .catch((error) => {
        failure = error;
      });
    await jest.advanceTimersByTimeAsync(RESPONSE_IDLE_DEADLINE_MS + 1);
    expect(failure).toMatchObject({ name: 'TimeoutError' });
    await reading;
    expect(jest.getTimerCount()).toBe(0);
  });
});
