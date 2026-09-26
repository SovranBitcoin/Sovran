/**
 * @jest-environment node
 *
 * The SDK's DEBUG lane prints raw refund bodies and whole cashu tokens, which
 * is why it was silenced wholesale. Silencing WARN and ERROR with it threw away
 * the only account of why a provider refused a request — the app was left
 * reporting `no_providers`, which says the walk ended, not what ended it.
 *
 * Forwarding them verbatim was not enough either: the app logger compacts any
 * string over 120 characters to a 32-character preview, and the SDK puts its
 * reason at the END of the line, so `app/log.txt` held 124-character
 * `createProviderToken: …` errors truncated exactly before the word that says
 * why. These tests pin the bounding and the flattening that fixed that.
 */
import { createSdkLogger, type SdkRefusal } from '@/shared/lib/routstr/sdk/sdkLogger';

function sink() {
  return { warn: jest.fn(), error: jest.fn() };
}

describe('createSdkLogger', () => {
  it('drops the lane that carries tokens and refund bodies', () => {
    const calls = sink();
    const logger = createSdkLogger(calls);
    logger.log('[RoutstrClient] token', 'cashuBo2Fte…');
    logger.debug('[RoutstrClient] refund body', { proofs: [] });
    expect(calls.warn).not.toHaveBeenCalled();
    expect(calls.error).not.toHaveBeenCalled();
  });

  it('forwards the message and detail of a warning', () => {
    const calls = sink();
    createSdkLogger(calls).warn('[RoutstrClient] upstream error', { status: 502 });
    expect(calls.warn).toHaveBeenCalledWith('routstr.sdk.warn', {
      scope: '',
      message: '[RoutstrClient] upstream error',
      status: 502,
    });
  });

  it('omits detail when the SDK passed only a message', () => {
    const calls = sink();
    createSdkLogger(calls).error('provider marked failed');
    expect(calls.error).toHaveBeenCalledWith('routstr.sdk.error', {
      scope: '',
      message: 'provider marked failed',
    });
  });

  it('keeps a non-string first argument as detail rather than a message', () => {
    const calls = sink();
    createSdkLogger(calls).error({ code: 'FAILOVER' }, 'after 1 provider');
    expect(calls.error).toHaveBeenCalledWith('routstr.sdk.error', {
      scope: '',
      message: '',
      detail: [{ code: 'FAILOVER' }, 'after 1 provider'],
    });
  });

  // The SDK hands each component its own child; the scope is how a warning
  // says which one spoke.
  it('accumulates child scopes', () => {
    const calls = sink();
    createSdkLogger(calls).child('RoutstrClient').child('BalanceManager').warn('low');
    expect(calls.warn).toHaveBeenCalledWith(
      'routstr.sdk.warn',
      expect.objectContaining({ scope: 'RoutstrClient:BalanceManager' })
    );
  });

  // The exact line from `app/log.txt` that read `{"_kind":"long_string",
  // "len":124,"preview":"createProviderToken: mint=https:…"}` — the phase, and
  // nothing about the mint being down.
  it('keeps the tail of a message too long for one field', () => {
    const calls = sink();
    const mint = 'https://mint.minibits.cash/Bitcoin';
    createSdkLogger(calls).error(
      `createProviderToken: mint=${mint} failed: Failed to fetch mint ${mint}`
    );
    const [, params] = calls.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(params.message).toHaveLength(118);
    expect(params.messageTail).toContain('Failed to fetch mint');
    expect(params.messageLen).toBe(124);
  });

  it('lifts a refusal into status, host, request id and the upstream reason', () => {
    const calls = sink();
    createSdkLogger(calls).child('RoutstrClient').error('[RoutstrClient] Upstream error response', {
      baseUrl: 'https://ai.example.com/',
      url: 'https://ai.example.com/v1/chat/completions',
      path: '/v1/chat/completions',
      status: 404,
      statusText: 'not found',
      requestId: 'c64887f1-fb44-4432-b687-0dbd77994dc2',
      body: '{"error": {"message": "Error forwarding request to upstream provider", "code": 404}}',
    });
    expect(calls.error).toHaveBeenCalledWith('routstr.sdk.error', {
      scope: 'RoutstrClient',
      message: '[RoutstrClient] Upstream error response',
      status: 404,
      statusText: 'not found',
      path: '/v1/chat/completions',
      requestId: 'c64887f1-fb44-4432-b687-0dbd77994dc2',
      host: 'ai.example.com',
      bodyLen: 84,
      reason: 'Error forwarding request to upstream provider',
      reasonParsed: true,
      errorCode: 404,
    });
  });

  // routstr-core's own refusals are FastAPI-shaped, not OpenAI-shaped.
  it('reads a FastAPI detail body as the reason', () => {
    const calls = sink();
    createSdkLogger(calls).error('Upstream wallet refund error response', {
      url: 'https://node.example/v1/wallet/refund',
      status: 425,
      body: '{"detail":"Refund is pending; retry shortly."}',
    });
    expect(calls.error).toHaveBeenCalledWith(
      'routstr.sdk.error',
      expect.objectContaining({
        status: 425,
        host: 'node.example',
        reason: 'Refund is pending; retry shortly.',
        reasonParsed: true,
      })
    );
  });

  // A body that is not JSON (an HTML error page, a proxy's plain text) still
  // has to say something; `reasonParsed` is how a reader knows which it got.
  it('falls back to the raw body when it is not a structured envelope', () => {
    const calls = sink();
    createSdkLogger(calls).error('Upstream error response', {
      status: 502,
      body: '<html><body>Bad Gateway</body></html>',
    });
    expect(calls.error).toHaveBeenCalledWith(
      'routstr.sdk.error',
      expect.objectContaining({
        reasonParsed: false,
        reason: expect.stringContaining('Bad Gateway'),
      })
    );
  });

  // The SDK's `FailoverError` carries none of the node's answer; this line
  // is where the answer survives, so the logger is also the channel back.
  it("hands the node's refusal to whoever asked for it", () => {
    const calls = sink();
    const refusals: SdkRefusal[] = [];
    const logger = createSdkLogger(calls, '', (refusal) => refusals.push(refusal));
    logger.child('RoutstrClient').error('[RoutstrClient] Upstream error response', {
      baseUrl: 'https://privateprovider.xyz/',
      path: '/v1/chat/completions',
      status: 404,
      statusText: 'not found',
      requestId: 'req-9',
      body: '{"error":{"message":"Error forwarding EHBP request to upstream","type":"upstream_error","code":404,"refund_token":"cashuBo2Ft"}}',
    });
    // A refund line is not a refusal of the request.
    logger.error('Upstream wallet refund error response', { status: 425, body: '{"detail":"x"}' });
    expect(refusals).toEqual([
      {
        status: 404,
        requestId: 'req-9',
        path: '/v1/chat/completions',
        message: 'Error forwarding EHBP request to upstream',
        type: 'upstream_error',
        code: 404,
      },
    ]);
  });

  it("reads the node's own classification out of a FastAPI detail envelope", () => {
    const calls = sink();
    createSdkLogger(calls).error('[RoutstrClient] Upstream error response', {
      status: 400,
      body: '{"detail":{"error":{"message":"Failed to redeem Cashu token","type":"cashu_error","code":"cashu_token_redemption_failed"}}}',
    });
    expect(calls.error).toHaveBeenCalledWith(
      'routstr.sdk.error',
      expect.objectContaining({
        reason: 'Failed to redeem Cashu token',
        errorType: 'cashu_error',
        errorCode: 'cashu_token_redemption_failed',
      })
    );
  });

  // The one send in the 2026-09-26 log that died at the 60-second mark logged
  // "Network error fetching from provider" and not one word of why: the SDK
  // puts the transport's own message under `error`, which was not lifted.
  it("keeps the transport's own words on a network failure", () => {
    const calls = sink();
    createSdkLogger(calls).error('[RoutstrClient] Network error fetching from provider', {
      baseUrl: 'https://privateprovider.xyz/',
      url: 'https://privateprovider.xyz/v1/chat/completions',
      path: '/v1/chat/completions',
      error: 'The request timed out.',
    });
    expect(calls.error).toHaveBeenCalledWith(
      'routstr.sdk.error',
      expect.objectContaining({
        host: 'privateprovider.xyz',
        path: '/v1/chat/completions',
        reason: 'The request timed out.',
      })
    );
  });

  it('never lets a token reach a field, whole or sliced', () => {
    const calls = sink();
    const token = `cashuB${'o2Fte'.repeat(60)}`;
    createSdkLogger(calls).error(`createProviderToken: token=${token} failed: mint refused it`);
    const [, params] = calls.error.mock.calls[0] as [string, Record<string, unknown>];
    const printed = JSON.stringify(params);
    expect(printed).not.toContain('cashuB');
    expect(printed).toContain('<REDACTED:cashu-token>');
    // Redaction runs before the slice, so what is left is short enough to
    // print whole — and the reason at the end survives, which is the point.
    expect(params.message).toContain('mint refused it');
    expect(params.messageTail).toBeUndefined();
  });

  it('turns a thrown error detail into a name and a bounded reason', () => {
    const calls = sink();
    createSdkLogger(calls).error(
      'fetchRefundToken fetch error',
      new Error('fetch failed: The network connection was lost.')
    );
    expect(calls.error).toHaveBeenCalledWith('routstr.sdk.error', {
      scope: '',
      message: 'fetchRefundToken fetch error',
      errorName: 'Error',
      reason: 'fetch failed: The network connection was lost.',
    });
  });
});
