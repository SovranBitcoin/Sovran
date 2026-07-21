/**
 * App-side mint-fault interceptor: each fake mode's observable shape, strict
 * passthrough for unmatched traffic, and the fail-closed WS factory gate.
 * The engine/rules matcher itself is covered by the harness's bun suite
 * (e2e/drivers/mint-faults.test.ts); this exercises the fetch boundary.
 */
/* eslint-disable no-restricted-globals, no-restricted-properties -- this suite exercises the raw fetch boundary the interceptor patches */
import { installMintFaultFetchInterceptor } from '../shared/lib/e2e/mintFaults/interceptor';
import { mintFaultEngine } from '../shared/lib/e2e/mintFaults/engine';
import { mintFaultRuleSetSchema } from '../shared/lib/e2e/mintFaults/rules';
import { maybeCreateMintFaultWebSocketFactory } from '../shared/lib/e2e/mintFaults/webSocketFactory';

const MINT = 'https://testnut.cashu.space';

const loadRules = (rules: unknown[], revision = 1) =>
  mintFaultEngine.loadRuleSet(mintFaultRuleSetSchema.parse({ version: 1, revision, rules }));

describe('mint-fault fetch interceptor', () => {
  const realFetch = globalThis.fetch;
  const passthroughCalls: string[] = [];

  beforeAll(() => {
    globalThis.fetch = jest.fn(async (input: unknown) => {
      passthroughCalls.push(String(input));
      return new Response('{"real":true}', { status: 200 });
    }) as unknown as typeof fetch;
    installMintFaultFetchInterceptor();
  });

  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  beforeEach(() => {
    passthroughCalls.length = 0;
    loadRules([]);
  });

  it('passes through everything with zero rules and non-mint traffic with rules', async () => {
    const armedButEmpty = await fetch(`${MINT}/v1/info`);
    expect(armedButEmpty.status).toBe(200);
    loadRules([{ id: 'r', mint: MINT, path: '/v1/swap', response: { mode: 'offline' } }]);
    await fetch('https://api.sovran.money/api/app/latest-version');
    expect(passthroughCalls).toHaveLength(2);
  });

  it('fakes a NUT-protocol error body and never touches the network', async () => {
    loadRules([
      {
        id: 'r',
        mint: MINT,
        path: '/v1/melt/bolt11',
        response: { mode: 'error', code: 20005, detail: 'Quote pending' },
      },
    ]);
    const response = await fetch(`${MINT}/v1/melt/bolt11`, { method: 'POST' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 20005, detail: 'Quote pending' });
    expect(passthroughCalls).toHaveLength(0);
  });

  it('fakes offline with the exact RN network-failure shape', async () => {
    loadRules([{ id: 'r', mint: MINT, response: { mode: 'offline' } }]);
    await expect(fetch(`${MINT}/v1/info`)).rejects.toThrow(new TypeError('Network request failed'));
  });

  it('fakes a clock-based timeout as an AbortError', async () => {
    loadRules([{ id: 'r', mint: MINT, response: { mode: 'timeout', afterMs: 10 } }]);
    await expect(fetch(`${MINT}/v1/swap`, { method: 'POST' })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('hangs a signal-based timeout until the caller aborts', async () => {
    loadRules([{ id: 'r', mint: MINT, response: { mode: 'timeout' } }]);
    const controller = new AbortController();
    const pending = fetch(`${MINT}/v1/swap`, { method: 'POST', signal: controller.signal });
    const raced = await Promise.race([
      pending.then(() => 'settled').catch(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);
    expect(raced).toBe('pending');
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('fakes malformed and arbitrary-status responses', async () => {
    loadRules([
      { id: 'bad', mint: MINT, path: '/v1/swap', response: { mode: 'malformed' } },
      {
        id: 'rate',
        mint: MINT,
        path: '/v1/info',
        response: { mode: 'httpStatus', status: 429, body: 'slow down' },
      },
    ]);
    const malformed = await fetch(`${MINT}/v1/swap`, { method: 'POST' });
    expect(malformed.status).toBe(200);
    await expect(malformed.json()).rejects.toThrow();
    const limited = await fetch(`${MINT}/v1/info`);
    expect(limited.status).toBe(429);
    expect(await limited.text()).toBe('slow down');
  });

  it('rejects an in-flight signal-less timeout fake when rules are swapped', async () => {
    loadRules([{ id: 'r', mint: MINT, response: { mode: 'timeout' } }]);
    const pending = fetch(`${MINT}/v1/swap`, { method: 'POST' });
    loadRules([], 2);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('lets sequenced (afterMatches) requests through for real', async () => {
    loadRules([
      {
        id: 'r',
        mint: MINT,
        path: '/v1/mint/bolt11',
        afterMatches: 1,
        response: { mode: 'offline' },
      },
    ]);
    const first = await fetch(`${MINT}/v1/mint/bolt11`, { method: 'POST' });
    expect(first.status).toBe(200);
    expect(passthroughCalls).toHaveLength(1);
    await expect(fetch(`${MINT}/v1/mint/bolt11`, { method: 'POST' })).rejects.toThrow(
      'Network request failed'
    );
  });
});

describe('mint-fault WS factory gate', () => {
  it('fails closed without the harness env', () => {
    expect(maybeCreateMintFaultWebSocketFactory()).toBeUndefined();
  });
});
