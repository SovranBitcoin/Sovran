/**
 * Regression for the stale-balance 402 loop: the local Routstr balance
 * only refreshed after a SUCCESSFUL stream, so once a key drained, the UI
 * gated every send against a phantom figure (observed on device: pill at
 * 299 sats, server reporting 216 mSats available) and the
 * insufficient-balance popup recurred forever. `throwResponseError` now
 * syncs the store balance from the 402's parsed `available` mSats.
 *
 * The 402 body below is byte-shaped like the live response captured in
 * log.txt (2026-07-02): FastAPI-style error envelope whose message embeds
 * "X mSats required … Y available".
 */

import { describeError } from '@/shared/lib/errors';
import { checkBalance, isWalletBalanceError, sendMessage } from '@/shared/lib/routstr/api';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  }),
}));

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: (e: { issues: unknown[] }) => e.issues,
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    apiLog: noop,
    storeLog: noop,
    aiLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

jest.mock('@/shared/lib/http/requestSignal', () => ({
  DEFAULT_TIMEOUT_MS: 10_000,
  buildAbortSignal: () => undefined,
}));

// The wallet half of a pay-per-request send. `@routstr/sdk` spends through
// this adapter, so stubbing it here is what keeps these tests about the
// classification above it rather than about Coco.
jest.mock('@/shared/lib/routstr/sdk/walletAdapter', () => ({
  cocoWalletAdapter: {
    getBalances: jest.fn(async () => ({ 'https://mint.example': 1000 })),
    getMintUnits: () => ({ 'https://mint.example': 'sat' }),
    getActiveMintUrl: () => 'https://mint.example',
    sendToken: jest.fn(async () => 'cashuB-request-payment'),
    receiveToken: jest.fn(async () => ({ success: true, amount: 0, unit: 'sat' })),
  },
}));

jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ selectedMint: 'https://mint.example' }) },
}));

const INSUFFICIENT_BODY = {
  error: {
    message: 'Insufficient balance: 85577 mSats required for this model. 216 available.',
    type: 'insufficient_quota',
    code: 'insufficient_balance',
  },
};

/** Test stub for the routstr chat/completions fetch (same pattern as
 *  blossomDelete.test.ts). */
function stubFetch402(body: unknown) {
  // eslint-disable-next-line no-restricted-properties -- test stub for the routstr 402 response
  global.fetch = jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 402,
        headers: { 'content-type': 'application/json' },
      })
  ) as unknown as typeof fetch;
}

describe('402 → balance truth-sync', () => {
  beforeEach(() => useRoutstrStore.getState().setApiKey('sk-test'));
  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
    global.fetch = realFetch;
  });

  // A chat completion no longer carries a hosted balance — it pays per request
  // out of the wallet — so the balance sync now only has a credential to own
  // on the wallet calls that still hold one. Those are what `reclaim` drains.
  it('overwrites the stale store balance with the 402 available mSats', async () => {
    useRoutstrStore.getState().setBalance(299_841); // the phantom figure
    stubFetch402(INSUFFICIENT_BODY);

    await expect(checkBalance('sk-test')).rejects.toMatchObject({ status: 402 });

    expect(useRoutstrStore.getState().balance).toBe(216);
  });

  it.each([
    [{ reason: 'Insufficient balance', amount_required_msat: 85577, balance_msat: 216 }, 216],
    [{ reason: 'Insufficient balance', amount_required_msat: 85577 }, 299841],
    [{ message: 'Insufficient balance', amount_required_msat: 85577, balance_msat: 0 }, 0],
    [{ reason: 'Insufficient balance', amount_required_msat: 85577, balance_msat: -1 }, 299841],
  ])('parses the v0.4.7 detail object without inventing a balance', async (detail, expected) => {
    useRoutstrStore.getState().setBalance(299841);
    stubFetch402({ detail });
    await expect(checkBalance('sk-test')).rejects.toMatchObject({
      status: 402,
      error: { message: 'Insufficient balance', details: { required: 85577 } },
    });
    expect(useRoutstrStore.getState().balance).toBe(expected);
  });

  it('keeps the legacy FastAPI string balance extraction', async () => {
    stubFetch402({ detail: 'Insufficient balance: 85577 mSats required, 216 available' });
    await expect(checkBalance('sk-test')).rejects.toMatchObject({
      error: { details: { required: 85577, available: 216 } },
    });
    expect(useRoutstrStore.getState().balance).toBe(216);
  });

  /**
   * routstr-core's `forward_upstream_error_response` hands the AI provider's
   * own JSON error body back verbatim under the provider's status. An
   * OpenRouter-shaped 402 has no `type` and a NUMERIC `code`, so it carries
   * none of routstr's wallet markers. Observed on device 2026-09-24: 100 sats
   * credited, 0 reserved, `gpt-oss-20b` (max_cost 19.86 sats), four of these
   * in a row — reported to the user as "Insufficient balance".
   */
  const UPSTREAM_402 = {
    error: { message: 'Provider returned error', code: 402 },
  };

  it('does not call a forwarded upstream 402 a wallet problem', async () => {
    useRoutstrStore.getState().setBalance(100_000);
    stubFetch402(UPSTREAM_402);

    const error = await sendMessage([{ role: 'user', content: 'hi' }], {
      model: 'gpt-oss-20b',
    }).catch((e: unknown) => e);

    expect(isWalletBalanceError(error)).toBe(false);
    // The numeric code must survive parsing — dropping it is what left `type`
    // to fall through to `unknown_error` and made the two 402s look identical.
    expect(error).toMatchObject({ status: 402, error: { code: '402' } });
    expect(describeError(error, 'routstr').id).toBe('routstr.provider_declined');
    // A funded wallet must not be rewritten by an error that is not about it.
    expect(useRoutstrStore.getState().balance).toBe(100_000);
  });

  it('still calls a routstr-raised 402 a wallet problem', async () => {
    stubFetch402(INSUFFICIENT_BODY);

    const error = await sendMessage([{ role: 'user', content: 'hi' }], {
      model: 'gpt-oss-20b',
    }).catch((e: unknown) => e);

    expect(isWalletBalanceError(error)).toBe(true);
    expect(describeError(error, 'routstr').id).toBe('routstr.balance');
  });

  it('leaves the balance untouched when the 402 carries no parseable available figure', async () => {
    useRoutstrStore.getState().setBalance(299_841);
    stubFetch402({ error: { message: 'Payment required', type: 'x' } });

    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'any' })
    ).rejects.toMatchObject({ status: 402 });

    expect(useRoutstrStore.getState().balance).toBe(299_841);
  });
});

/**
 * `readRoutstrEnvelope` checks HTTP status BEFORE shape. That order is
 * load-bearing and easy to lose: every Routstr spine is a `looseObject` of
 * optional fields, so an error body parses cleanly, and the balance reader's
 * `?? 0` defaults would turn a rejected key into a confident "0 sats" — the
 * figure every affordability check then gates against.
 */
describe('envelope reads gate on HTTP status before shape', () => {
  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
    global.fetch = realFetch;
  });

  it('rejects a 401 /wallet/info rather than reading the error body as a zero balance', async () => {
    // eslint-disable-next-line no-restricted-properties -- test stub for the routstr 401 response
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'Invalid API key' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;

    await expect(checkBalance('sk-expired')).rejects.toMatchObject({ status: 401 });
  });
});

describe('Routstr errors retain machine-readable evidence for shared presentation', () => {
  // eslint-disable-next-line no-restricted-properties -- fetch fixture boundary
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore fixture boundary
    global.fetch = realFetch;
  });

  it.each([
    [404, { detail: 'Not found' }, 'routstr.not_found'],
    [
      400,
      {
        error: { message: 'Unknown model', type: 'invalid_request_error', code: 'model_not_found' },
      },
      'routstr.model_unavailable',
    ],
  ])('preserves status %s and translates it only at presentation', async (status, body, id) => {
    // eslint-disable-next-line no-restricted-properties -- fetch fixture boundary
    global.fetch = jest.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    ) as unknown as typeof fetch;
    await sendMessage([{ role: 'user', content: 'hi' }], {
      model: 'test-model',
    }).then(
      () => {
        throw new Error('Expected request to fail');
      },
      (error) => {
        expect(error.status).toBe(status);
        expect(error.error.message).toBe(status === 404 ? 'Not found' : 'Unknown model');
        expect(describeError(error, 'routstr').id).toBe(id);
        if (status === 400) expect(error.error.code).toBe('model_not_found');
      }
    );
  });

  it.each([
    ['status', Object.assign(new Error('payment required'), { status: 402 })],
    ['abort name', Object.assign(new Error('Aborted'), { name: 'AbortError' })],
  ])('rethrows a mid-stream failure with its %s intact', async (_label, failure) => {
    const body = {
      getReader: () => ({ read: async () => Promise.reject(failure), releaseLock: jest.fn() }),
    };
    // eslint-disable-next-line no-restricted-properties -- fetch fixture boundary
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body,
    })) as unknown as typeof fetch;

    const { stream } = await sendMessage([{ role: 'user', content: 'hi' }], {
      model: 'test-model',
    });
    const drain = async () => {
      for await (const _chunk of stream) {
        // no chunks expected
      }
    };
    await expect(drain()).rejects.toBe(failure);
  });
});

describe('SDK failures keep their status', () => {
  /**
   * `@routstr/sdk` throws typed errors carrying the upstream status, the
   * provider and the request id. Flattening them into `status: 0` — which this
   * app did — is why a provider refusing a model read on screen as a bare
   * "Failed to send message", and why the candidate walk could not advance
   * past it: that walk turns on the difference between a 402 and a 503.
   */
  const routeRequestThrowing = (error: unknown) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw error;
    });
  };

  const send = () => sendMessage([{ role: 'user', content: 'hi' }], { model: 'any' });

  it('gives a provider refusal back its upstream status', async () => {
    const { ProviderError } = require('@routstr/sdk/browser');
    routeRequestThrowing(new ProviderError('https://node.example', 402, 'upstream declined'));
    await expect(send()).rejects.toMatchObject({
      status: 402,
      error: { code: 'provider_error' },
    });
  });

  it('names a mint refusal as one, so the advice is to change mint', async () => {
    const { MintError } = require('@routstr/sdk/browser');
    routeRequestThrowing(
      new MintError({
        baseUrl: 'https://node.example',
        statusCode: 422,
        code: 'cashu_token_swap_fees_exceed_amount',
      })
    );
    const rejection = await send().catch((e: unknown) => e);
    expect(rejection).toMatchObject({ status: 422, error: { type: 'mint_error' } });
    expect(describeError(rejection, 'routstr').id).toBe('routstr.mint_refused');
  });

  it('reports exhausted failover as unavailable, not as a network blip', async () => {
    const { NoProvidersAvailableError } = require('@routstr/sdk/browser');
    routeRequestThrowing(new NoProvidersAvailableError());
    await expect(send()).rejects.toMatchObject({ status: 503, error: { code: 'no_providers' } });
  });
});
