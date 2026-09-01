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

import { checkBalance, sendMessage } from '@/shared/lib/routstr/api';
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
  // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
  const realFetch = global.fetch;
  afterEach(() => {
    // eslint-disable-next-line no-restricted-properties -- restore seam for the stub
    global.fetch = realFetch;
  });

  it('overwrites the stale store balance with the 402 available mSats', async () => {
    useRoutstrStore.getState().setBalance(299_841); // the phantom figure
    stubFetch402(INSUFFICIENT_BODY);

    await expect(
      sendMessage('sk-test', [{ role: 'user', content: 'hi' }], { model: 'gemma-4-26b-a4b-it' })
    ).rejects.toMatchObject({ status: 402 });

    expect(useRoutstrStore.getState().balance).toBe(216);
  });

  it('leaves the balance untouched when the 402 carries no parseable available figure', async () => {
    useRoutstrStore.getState().setBalance(299_841);
    stubFetch402({ error: { message: 'Payment required', type: 'x' } });

    await expect(
      sendMessage('sk-test', [{ role: 'user', content: 'hi' }], { model: 'any' })
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
