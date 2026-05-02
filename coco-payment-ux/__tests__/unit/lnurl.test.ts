/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * lnurl.ts — LNURL trust boundary
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `requestInvoiceFromLnurl` sits on the melt critical path: a hostile
 * lightning-address provider that returns a bolt11 encoding 100k sats when
 * the user asked for 100 would otherwise reach `mgr.ops.melt.prepare` and
 * drain the user's balance. These tests pin the four boundary checks:
 *   1. The callback URL is composed via `URL.searchParams.set`, so a
 *      callback that already carries `?token=…` doesn't produce double-`?`.
 *   2. The callback's protocol is `https:` (or `http:` for `.onion`); a
 *      pay-params payload that returns an `http://` clearnet callback is
 *      rejected with `LNURL_INSECURE_CALLBACK`.
 *   3. The bolt11 returned by the callback is decoded and its msat amount
 *      is asserted to equal the request — mismatch surfaces as
 *      `LNURL_INVOICE_AMOUNT_MISMATCH`.
 *   4. Both fetches are bounded by `safeFetch`'s timeout so a stalled
 *      provider cannot wedge the melt flow indefinitely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LnurlError, requestInvoiceFromLnurl } from '../../src/lnurl';

// 21-sat bolt11 invoice used as the "good" callback response.
// Decodes to 21000 msats (LUD-06 amount).
const BOLT11_21_SATS =
  'lnbc210n1p56amv8sp5v5gvxh0swyje66pcxtqtqh3qmzxd74fkxhjmzgzw7nff9fuhcdgqpp566zkpvgxn832cg06ghlk48tqntffkp6nsemw8g836pjfw4tdhdmsdqgde6hgv3kxqyjw5qcqpjrzjqwryaup9lh50kkranzgcdnn2fgvx390wgj5jd07rwr3vxeje0glc7rf05uqqg8gqqqqqqqlgqqqqrucqjq9qxpqysgqrdvjgsemgtxs3wa38xf8qs3awqf5ksw0d3mpm07t9yl7xkasyzgz8rw5qlas6r4ers68u7nmgvqsgar4t9lr47fwlaue302nrasdekgqnvfjmp';

const PAY_PARAMS_URL = 'https://example.com/.well-known/lnurlp/alice';

const okJson = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  }) as unknown as Response;

const httpError = (status: number): Response =>
  ({
    ok: false,
    status,
    statusText: 'Bad Gateway',
    json: async () => ({}),
  }) as unknown as Response;

interface Plan {
  payParams: unknown;
  invoiceResponse: unknown | { httpError: number };
}

let fetchCalls: { url: string; init?: RequestInit }[] = [];

function installFetch(plan: Plan, opts: { stallInvoice?: boolean } = {}) {
  fetchCalls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    if (url.includes('/.well-known/lnurlp/')) {
      return okJson(plan.payParams);
    }
    if (opts.stallInvoice) {
      // Resolve only when the abort signal trips; that's how safeFetch's
      // timeout reaches us. If the test passes a real signal, we surface
      // an AbortError on abort so isAbortError() recognises it.
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        const onAbort = () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (signal?.aborted) onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    if (
      typeof plan.invoiceResponse === 'object' &&
      plan.invoiceResponse !== null &&
      'httpError' in plan.invoiceResponse
    ) {
      return httpError((plan.invoiceResponse as { httpError: number }).httpError);
    }
    return okJson(plan.invoiceResponse);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchCalls = [];
});

describe('requestInvoiceFromLnurl — happy path', () => {
  it('returns the invoice when the callback amount matches the request', async () => {
    installFetch({
      payParams: {
        callback: 'https://example.com/lnurl-pay/cb',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { pr: BOLT11_21_SATS },
    });

    const invoice = await requestInvoiceFromLnurl('alice@example.com', 21);
    expect(invoice).toBe(BOLT11_21_SATS);
  });

  it('uses URL.searchParams to merge amount with a pre-existing query string', async () => {
    // LUD-06 callbacks routinely look like `…?token=abc`. Naive concat
    // would produce `…?token=abc?amount=21000`, breaking the URL.
    installFetch({
      payParams: {
        callback: 'https://example.com/lnurl-pay/cb?token=abc',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { pr: BOLT11_21_SATS },
    });

    await requestInvoiceFromLnurl('alice@example.com', 21);

    const callbackCall = fetchCalls.find((c) => c.url.includes('/lnurl-pay/cb'));
    expect(callbackCall).toBeDefined();
    const composed = new URL(callbackCall!.url);
    expect(composed.searchParams.get('token')).toBe('abc');
    expect(composed.searchParams.get('amount')).toBe('21000');
    // Exactly one '?' — no double-query corruption.
    expect((callbackCall!.url.match(/\?/g) ?? []).length).toBe(1);
  });
});

describe('requestInvoiceFromLnurl — boundary checks', () => {
  it('rejects an invoice whose decoded amount does not match the request', async () => {
    // Provider returns a bolt11 for 21 sats when the user asked for 100.
    installFetch({
      payParams: {
        callback: 'https://example.com/lnurl-pay/cb',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { pr: BOLT11_21_SATS },
    });

    await expect(requestInvoiceFromLnurl('alice@example.com', 100)).rejects.toMatchObject({
      name: 'LnurlError',
      code: 'LNURL_INVOICE_AMOUNT_MISMATCH',
    });
  });

  it('rejects an http:// clearnet callback URL', async () => {
    installFetch({
      payParams: {
        callback: 'http://evil.example.com/lnurl-pay/cb',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { pr: BOLT11_21_SATS },
    });

    await expect(requestInvoiceFromLnurl('alice@example.com', 21)).rejects.toMatchObject({
      name: 'LnurlError',
      code: 'LNURL_INSECURE_CALLBACK',
    });
  });

  it('accepts an http:// callback when the host is .onion', async () => {
    installFetch({
      payParams: {
        callback: 'http://abcdefghijklmnop.onion/lnurl-pay/cb',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { pr: BOLT11_21_SATS },
    });

    const invoice = await requestInvoiceFromLnurl('alice@example.com', 21);
    expect(invoice).toBe(BOLT11_21_SATS);
  });

  it('rejects an amount outside [minSendable, maxSendable]', async () => {
    installFetch({
      payParams: {
        callback: 'https://example.com/lnurl-pay/cb',
        minSendable: 100_000,
        maxSendable: 200_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { pr: BOLT11_21_SATS },
    });

    await expect(requestInvoiceFromLnurl('alice@example.com', 21)).rejects.toMatchObject({
      name: 'LnurlError',
      code: 'LNURL_AMOUNT_OUT_OF_RANGE',
    });
  });

  it('surfaces an HTTP error on the invoice fetch as LNURL_INVOICE_FETCH_FAILED', async () => {
    installFetch({
      payParams: {
        callback: 'https://example.com/lnurl-pay/cb',
        minSendable: 1000,
        maxSendable: 1_000_000_000,
        metadata: '[]',
        tag: 'payRequest',
      },
      invoiceResponse: { httpError: 502 },
    });

    await expect(requestInvoiceFromLnurl('alice@example.com', 21)).rejects.toMatchObject({
      name: 'LnurlError',
      code: 'LNURL_INVOICE_FETCH_FAILED',
    });
  });

  it('surfaces a stalled callback fetch as LNURL_TIMEOUT within timeoutMs', async () => {
    installFetch(
      {
        payParams: {
          callback: 'https://example.com/lnurl-pay/cb',
          minSendable: 1000,
          maxSendable: 1_000_000_000,
          metadata: '[]',
          tag: 'payRequest',
        },
        invoiceResponse: { pr: BOLT11_21_SATS },
      },
      { stallInvoice: true }
    );

    const error = (await requestInvoiceFromLnurl('alice@example.com', 21, {
      timeoutMs: 30,
    }).catch((e) => e)) as LnurlError;
    expect(error).toBeInstanceOf(LnurlError);
    expect(error.code).toBe('LNURL_TIMEOUT');
  });
});

// Suppress the warn we emit on invalid pay params shapes — tests assert
// the rejection path; the console noise is not the contract.
beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

// keep PAY_PARAMS_URL referenced for clarity; not used outside the harness
void PAY_PARAMS_URL;
