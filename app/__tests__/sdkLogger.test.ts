/**
 * @jest-environment node
 *
 * The SDK's DEBUG lane prints raw refund bodies and whole cashu tokens, which
 * is why it was silenced wholesale. Silencing WARN and ERROR with it threw away
 * the only account of why a provider refused a request — the app was left
 * reporting `no_providers`, which says the walk ended, not what ended it.
 */
import { createSdkLogger } from '@/shared/lib/routstr/sdk/sdkLogger';

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
      detail: [{ status: 502 }],
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
});
