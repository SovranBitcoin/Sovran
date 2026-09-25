/**
 * @jest-environment node
 *
 * What a failed AI request has to say about itself.
 *
 * On 2026-09-25 a user walked through dozens of providers because every
 * failure read the same: `status: 0`, `type: network_error`, error id
 * `routstr.unavailable` — "The AI provider is unreachable right now." Six of
 * seventeen attempts in `app/log.txt` never reached `routstr.sdk.sent` at all,
 * and the SDK's own account of each one arrived only afterwards, as
 * `createProviderToken: … failed: Failed to fetch mint
 * https://mint.minibits.cash/Bitcoin` — while that mint's `/v1/info` was
 * answering 502. The provider was fine. The wallet's mint was down, and no
 * amount of switching provider could have helped.
 *
 * So two things are pinned here: a mint failure is reported as a mint failure,
 * and every failure says which phase it died in and whether the token was ever
 * minted — the difference between "we never paid" and "we paid and got
 * nothing", which the log could previously only be made to yield by noticing
 * which events were absent.
 */

import { apiLog } from '@/shared/lib/logger';
import { sendMessage, setRoutstrNodeBaseUrl } from '@/shared/lib/routstr/api';

const mockRoute = jest.fn<Promise<Response>, [{ signal?: AbortSignal }]>();
const mockPayment = jest.fn(() => ({
  mintedSats: null as number | null,
  mintedFromHost: undefined as string | undefined,
  changeSats: null as number | null,
  changeReceived: false,
  changeFailed: false,
}));
jest.mock('@/shared/lib/routstr/sdk/client', () => ({
  getRoutstrClient: async () => ({
    client: { routeRequest: mockRoute },
    baseUrl: 'https://node.example/',
    payment: mockPayment,
    finish: async () => {},
  }),
  acceptedMintsForProvider: async () => ['https://mint.example'],
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
jest.mock('@/shared/stores/profile/routstrStore', () => ({
  useRoutstrStore: {
    getState: () => ({
      lineup: {
        openai: {
          auto: { modelId: 'm', upstreamId: 'openrouter' },
          pro: null,
          max: null,
        },
      },
      invalidateServerLineup: jest.fn(),
    }),
  },
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { apiLog: log, aiLog: log, storeLog: log, log, applyFileLogging: jest.fn() };
});

const logged = (event: string): Record<string, unknown> | undefined => {
  for (const level of ['info', 'warn', 'error', 'debug'] as const) {
    const call = (apiLog[level] as jest.Mock).mock.calls.find(([name]) => name === event);
    if (call) return call[1] as Record<string, unknown>;
  }
  return undefined;
};

const payment = { groupId: 'ai-send-1790321451384', model: 'gpt-oss-20b' };

describe('Routstr attempt diagnostics', () => {
  beforeEach(() => {
    mockRoute.mockReset();
    mockPayment.mockReset().mockReturnValue({
      mintedSats: null,
      mintedFromHost: undefined,
      changeSats: null,
      changeReceived: false,
      changeFailed: false,
    });
    for (const level of ['info', 'warn', 'error', 'debug'] as const) {
      (apiLog[level] as jest.Mock).mockReset();
    }
    setRoutstrNodeBaseUrl('https://node.example');
  });

  it('names the mint, the node and the flow before anything can go wrong', async () => {
    mockRoute.mockRejectedValue(new Error('nope'));
    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'm', max_tokens: 4096, payment })
    ).rejects.toBeDefined();

    // A node whose OpenRouter credit is gone serves a perfect catalog and
    // still 404s, so the account a model bills to is what many runs across
    // many providers have to be grouped by.
    expect(logged('api.routstr.chat.start')).toMatchObject({
      flowId: payment.groupId,
      upstreamId: 'openrouter',
    });
    expect(logged('api.routstr.chat.mint_selected')).toMatchObject({
      flowId: payment.groupId,
      nodeHost: 'node.example',
      mintHost: 'mint.example',
      matchedSelection: true,
      acceptedMints: 1,
    });
    // The last line before the SDK takes over. `routstr.sdk.sent` after this
    // means a token was minted; nothing after it means it was not.
    expect(logged('api.routstr.chat.dispatch')).toMatchObject({
      flowId: payment.groupId,
      nodeHost: 'node.example',
      mintHost: 'mint.example',
      max_tokens: 4096,
    });
  });

  it('calls a mint outage a mint outage instead of an unreachable provider', async () => {
    mockRoute.mockRejectedValue(
      new Error('Failed to fetch mint https://mint.minibits.cash/Bitcoin')
    );

    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], {
        model: 'm',
        max_tokens: 4096,
        payment,
      })
    ).rejects.toMatchObject({
      status: 0,
      // `mint_error` maps to `routstr.mint_refused`, whose copy points at the
      // mint. `network_error` mapped to `routstr.unavailable`, which points at
      // the provider and sent the user round the whole directory.
      error: { type: 'mint_error', code: 'mint_unreachable' },
    });

    expect(logged('api.routstr.chat.failed')).toMatchObject({
      flowId: payment.groupId,
      phase: 'payment',
      tokenMinted: false,
      nodeHost: 'node.example',
      reason: 'Failed to fetch mint https://mint.minibits.cash/Bitcoin',
    });
  });

  it('separates a node that refused from a payment that never happened', async () => {
    mockPayment.mockReturnValue({
      mintedSats: 38,
      mintedFromHost: 'mint.example',
      changeSats: 38,
      changeReceived: true,
      changeFailed: false,
    });
    mockRoute.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Error forwarding request', code: 404 } }), {
        status: 404,
        headers: { 'content-type': 'application/json', 'x-routstr-request-id': 'req-1' },
      })
    );

    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'm', payment })
    ).rejects.toMatchObject({ status: 404 });

    expect(logged('api.routstr.chat.response_received')).toMatchObject({
      flowId: payment.groupId,
      status: 404,
      requestId: 'req-1',
      hasChangeHeader: false,
      mintedSats: 38,
    });
    expect(logged('api.routstr.chat.failed')).toMatchObject({
      flowId: payment.groupId,
      phase: 'headers',
      status: 404,
      tokenMinted: true,
      mintedSats: 38,
      changeSats: 38,
      changeReceived: true,
      reason: expect.stringContaining('Error forwarding request'),
    });
  });

  it('records that the change never came home, which is the only line that costs sats', async () => {
    mockPayment.mockReturnValue({
      mintedSats: 33,
      mintedFromHost: 'mint.example',
      changeSats: null,
      changeReceived: false,
      changeFailed: true,
    });
    mockRoute.mockResolvedValue(
      new Response('{"error":{"message":"An unexpected error occurred"}}', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'm', payment })
    ).rejects.toMatchObject({ status: 500 });

    expect(logged('api.routstr.chat.failed')).toMatchObject({
      tokenMinted: true,
      mintedSats: 33,
      changeReceived: false,
      changeFailed: true,
    });
  });
});
