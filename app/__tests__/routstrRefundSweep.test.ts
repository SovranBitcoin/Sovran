/**
 * @jest-environment node
 *
 * The recovery sweep, and the one status that was quietly costing money.
 *
 * `POST /v1/wallet/refund` answers 425 `{"detail":"Refund is pending; retry
 * shortly."}` with `Retry-After: 2` when the node has taken the payment token
 * but has not yet written the refund row — routstr-core's own comment calls it
 * a race between the client polling and the upstream request finishing. The
 * sweep runs the instant a request fails, which is exactly when that race is
 * open, and it used to ask once and stop. `app/log.txt` shows the result: 121
 * refusals across four nodes and seventeen consecutive
 * `routstr.sdk.sweep {attempted: 8, recovered: 0}` over three hours, with the
 * same eight tokens stranded the whole time.
 */

import { apiLog } from '@/shared/lib/logger';
import {
  getRoutstrClient,
  PENDING_DEDUPE_AFTER_MS,
  resetRoutstrClient,
  sweepUnsettledPayments,
} from '@/shared/lib/routstr/sdk/client';

const mockWrites: { value: string }[] = [];
let mockFetch: jest.SpiedFunction<typeof fetch>;
const mockSend = jest.fn(async () => 'cashuB-fixture');
const mockReceive = jest.fn(async () => ({ success: true, amount: 3, unit: 'sat' as const }));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  captureProfileStorageOwner: async () => 'a'.repeat(64),
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));
jest.mock('@/shared/stores/global/profileStore', () => ({
  useProfileStore: {
    getState: () => ({
      activeAccountIndex: 0,
      profiles: [{ accountIndex: 0, pubkey: 'a'.repeat(64) }],
    }),
  },
}));
jest.mock('@/shared/lib/routstr/secureVault', () => ({
  createSecureVault: () => ({
    read: async () => null,
    write: async (value: string) => {
      mockWrites.push({ value });
    },
  }),
}));
jest.mock('@/shared/lib/routstr/sdk/walletAdapter', () => ({
  createCocoWalletAdapter: () => ({
    getBalances: async () => ({ 'https://mint.example': 100 }),
    getMintUnits: () => ({ 'https://mint.example': 'sat' }),
    getActiveMintUrl: () => 'https://mint.example',
    sendToken: mockSend,
    receiveToken: mockReceive,
  }),
  tokenAmountSats: () => 3,
}));
jest.mock('@/shared/lib/logger', () => ({
  apiLog: { info: jest.fn(), warn: jest.fn() },
}));

const mockLogInfo = apiLog.info as jest.Mock;
const mockLogWarn = apiLog.warn as jest.Mock;

/** One request that leaves a token journalled for the sweep to chase. */
async function journalOneToken() {
  const bound = await getRoutstrClient('https://node.example');
  await bound.client.routeRequest({
    path: '/v1/chat/completions',
    method: 'POST',
    baseUrl: bound.baseUrl,
    mintUrl: 'https://mint.example',
    body: { model: 'm' },
    modelId: 'm',
  });
}

const refundCalls = () =>
  mockFetch.mock.calls.filter(([url]) => String(url).includes('/v1/wallet/refund'));

const sweepEvents = (name: string) =>
  [...mockLogInfo.mock.calls, ...mockLogWarn.mock.calls].filter(([event]) => event === name);

describe('Routstr refund sweep', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetRoutstrClient();
    mockWrites.length = 0;
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockSend.mockReset().mockResolvedValue('cashuB-fixture');
    mockReceive.mockReset().mockResolvedValue({ success: true, amount: 3, unit: 'sat' });
    mockFetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', {
        // No `x-cashu`: the request itself settles nothing, so the token stays
        // journalled and the sweep has something to chase.
        headers: { 'content-type': 'application/json' },
      })
    );
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const pending = () =>
    new Response(JSON.stringify({ detail: 'Refund is pending; retry shortly.' }), {
      status: 425,
      headers: { 'retry-after': '2' },
    });

  it('retries a pending refund and banks the change the node finally mints', async () => {
    await journalOneToken();
    mockFetch
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(pending())
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'cashuB-refund' })));

    const sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;

    expect(refundCalls()).toHaveLength(3);
    expect(mockReceive).toHaveBeenCalledWith('cashuB-refund');
    expect(sweepEvents('routstr.sdk.sweep')[0][1]).toMatchObject({
      attempted: 1,
      recovered: 1,
      recoveredSats: 3,
      pending: 0,
    });
  });

  it('reports what is still stranded when the node never stops saying "pending"', async () => {
    await journalOneToken();
    // A fresh Response per call: a body can only be read once, and the sweep
    // reads every one of them.
    mockFetch.mockImplementation(async () => pending());

    const sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;

    // Bounded: the node is asked three times, not forever.
    expect(refundCalls()).toHaveLength(3);
    expect(mockReceive).not.toHaveBeenCalled();
    expect(sweepEvents('routstr.sweep.token')[0][1]).toMatchObject({
      host: 'node.example',
      outcome: 'pending',
      status: 425,
      attempts: 3,
      sats: 3,
      reason: expect.stringContaining('Refund is pending'),
    });
    expect(sweepEvents('routstr.sdk.sweep')[0][1]).toMatchObject({
      attempted: 1,
      recovered: 0,
      pending: 1,
      strandedSats: 3,
    });
  });

  // A node holding a payment row with no change row says "pending" until its
  // upstream call ends, which no amount of asking hurries. Every failed send
  // runs a sweep; a stuck token was costing each of them three refund calls.
  it('asks a node about a stale pending token once per session', async () => {
    await journalOneToken();
    // Stale: journalled longer ago than the dedupe window. A fresh one keeps
    // being asked about (next case).
    jest.advanceTimersByTime(PENDING_DEDUPE_AFTER_MS + 1);
    mockFetch.mockImplementation(async () => pending());

    let sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;
    expect(refundCalls()).toHaveLength(3);

    sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;
    // No new calls, and the summary still counts it as stranded.
    expect(refundCalls()).toHaveLength(3);
    expect(sweepEvents('routstr.sdk.sweep')[1][1]).toMatchObject({
      attempted: 0,
      pending: 1,
      strandedSats: 3,
    });
  });

  // The token from a request that failed a moment ago is the one whose node is
  // about to write its refund row. Once-per-session is for the stale ones.
  it('keeps asking about a token that was journalled minutes ago', async () => {
    await journalOneToken();
    mockFetch.mockImplementation(async () => pending());

    let sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;
    expect(refundCalls()).toHaveLength(3);

    // Fresh — journalled inside the dedupe window — so the second sweep asks
    // again, and this time the node has finished.
    mockFetch.mockImplementation(
      async () => new Response(JSON.stringify({ token: 'cashuB-refund' }))
    );
    sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;
    expect(refundCalls()).toHaveLength(4);
    expect(mockReceive).toHaveBeenCalledWith('cashuB-refund');
  });

  // The app was closed mid-answer and relaunched: the launch sweep meets a
  // 425 for a token minted minutes ago. The node is still finishing; asking
  // again in a minute is how the change comes home without another launch.
  it('schedules follow-up sweeps when a fresh token is still pending', async () => {
    await journalOneToken();
    mockFetch.mockImplementation(async () => pending());

    const sweeping = sweepUnsettledPayments('launch');
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;
    expect(sweepEvents('routstr.sdk.recovery_scheduled')).toHaveLength(1);

    // A scheduled sweep that still finds it pending does not schedule more.
    const followUp = sweepUnsettledPayments('scheduled');
    await jest.advanceTimersByTimeAsync(10_000);
    await followUp;
    expect(sweepEvents('routstr.sdk.recovery_scheduled')).toHaveLength(1);
  });

  // A 1-sat token against a sub-sat turn: cost rounds to the whole token, the
  // node sends no change, and the SDK keeps chasing money that is not owed.
  it('forgets a token the node consumed in full', async () => {
    const bound = await getRoutstrClient('https://node.example');
    await bound.client.routeRequest({
      path: '/v1/chat/completions',
      method: 'POST',
      baseUrl: bound.baseUrl,
      mintUrl: 'https://mint.example',
      body: { model: 'm' },
      modelId: 'm',
    });
    bound.settleWithoutChange();

    const sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;
    expect(refundCalls()).toHaveLength(0);
    expect(sweepEvents('routstr.sdk.sweep')).toHaveLength(0);
  });

  // A 404 means the node never recorded the payment, so the mint — not the
  // node — is still the spend authority for the original token.
  it('does not wait out a backoff for a status that will not change', async () => {
    await journalOneToken();
    mockFetch.mockImplementation(async () => new Response('{}', { status: 404 }));

    const sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;

    expect(refundCalls()).toHaveLength(1);
    expect(mockReceive).toHaveBeenCalledWith('cashuB-fixture');
  });

  // The 33 sats lost on 2026-09-25: the node returned change the mint refused.
  // Whether that is a double-bank or a node reissuing something it had already
  // spent, the log has to name the amount and the node.
  it('names the node and the amount when returned change will not redeem', async () => {
    await journalOneToken();
    mockFetch.mockImplementation(
      async () => new Response(JSON.stringify({ token: 'cashuB-refund' }))
    );
    const refusal: { success: boolean; amount: number; unit: 'sat'; message: string } = {
      success: false,
      amount: 0,
      unit: 'sat',
      message: 'Token Already Spent',
    };
    mockReceive.mockResolvedValue(refusal);

    const sweeping = sweepUnsettledPayments();
    await jest.advanceTimersByTimeAsync(10_000);
    await sweeping;

    expect(sweepEvents('routstr.sweep.token')[0][1]).toMatchObject({
      host: 'node.example',
      outcome: 'unredeemable',
      sats: 3,
      fromRefund: true,
      reason: 'Token Already Spent',
    });
  });
});
