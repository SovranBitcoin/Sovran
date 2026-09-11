/** @jest-environment node */
import {
  MintOperationError,
  MintFetchError,
  ProofOperationError,
  OperationInProgressError,
  AuthSessionExpiredError,
} from '@cashu/coco-core';
import { describeError } from '@/shared/lib/errors';

it('uses a wrapped Cashu code ahead of the generic HTTP 400 and wrapper message', () => {
  const mintError = Object.assign(new Error('vendor-specific detail'), {
    name: 'MintOperationError',
    status: 400,
    code: 11002,
  });
  const wrapped = new Error('Failed to receive token', { cause: mintError });
  expect(describeError(wrapped, 'cashu')).toEqual({
    id: 'cashu.proofs_pending',
    text: 'This ecash is involved in a pending operation. Check its status before trying to spend it again.',
  });
});

it.each([
  ['CDK', { code: 11001, detail: 'Token already spent' }],
  ['Nutshell', { code: 11001, detail: 'proofs already spent' }],
  [
    'Coco cause',
    new Error('Proof operation failed', { cause: { code: 11001, detail: 'different detail' } }),
  ],
])('maps %s spent errors to the same presentation', (_source, error) => {
  expect(describeError(error, 'cashu').id).toBe('cashu.proofs_spent');
});

it.each([
  [20002, 'cashu.quote_issued'],
  [20003, 'cashu.disabled'],
  [20006, 'cashu.invoice_paid'],
  [20008, 'cashu.signature'],
  [31004, 'rate_limited'],
])('keeps code %s semantics independent of vendor detail', (code, id) => {
  expect(describeError({ status: 400, code, detail: 'opaque vendor detail' }, 'cashu').id).toBe(id);
});

it('does not guess that an unknown mint code means insufficient funds from its detail', () => {
  expect(
    describeError({ code: 999, detail: 'insufficient balance in mint backend' }, 'cashu').id
  ).toBe('cashu.unknown');
});

it.each(['routstr', 'nostr', 'nagg', 'app'] as const)(
  'does not apply Cashu codes to %s',
  (service) => {
    expect(describeError({ code: 11001, message: 'token already spent' }, service).id).not.toBe(
      'cashu.proofs_spent'
    );
  }
);

it('keeps a failed AI credit top-up separate from a Cashu token error', () => {
  expect(
    describeError({ status: 402, error: { code: 'insufficient_balance' } }, 'routstr').id
  ).toBe('routstr.balance');
});

it('distinguishes an explicitly rejected model from an ambiguous 404', () => {
  expect(describeError({ status: 404, error: { code: 'model_not_found' } }, 'routstr').id).toBe(
    'routstr.model_unavailable'
  );
});

it.each([
  [{ name: 'HttpResponseError', status: 429 }, 'rate_limited'],
  [{ name: 'HttpResponseError', status: 504 }, 'cashu.timeout'],
  [{ name: 'HttpResponseError', status: 200 }, 'cashu.unavailable'],
  [{ name: 'NetworkError', cause: new Error('fetch failed') }, 'cashu.network'],
  [new Error('FAILURE_REASON_NO_ROUTE'), 'cashu.no_route'],
])('handles Cashu transport failures without payment outcome claims', (error, id) => {
  expect(describeError(error, 'cashu').id).toBe(id);
});

it('preserves Nagg HTTP and schema meanings through Error.cause', () => {
  expect(
    describeError(new Error('load failed', { cause: { type: 'http', status: 503 } }), 'nagg').id
  ).toBe('nagg.unavailable');
  expect(describeError({ type: 'schema', issues: [] }, 'nagg').id).toBe('nagg.invalid_response');
});

it('does not claim every relay rejected an event based on one relay response', () => {
  expect(
    describeError(
      {
        type: 'all-failed',
        relayResults: [
          { ok: false, reason: 'rejected', message: 'blocked: secret detail' },
          { ok: false, reason: 'timeout' },
        ],
      },
      'nostr'
    ).id
  ).toBe('nostr.all_failed');
});

it.each(['no-signer', 'sign-failed', 'no-relays'] as const)('recognizes Nostr %s', (type) => {
  expect(describeError(new Error('publish failed', { cause: { type } }), 'nostr').id).toBe(
    `nostr.${type.replaceAll('-', '_')}`
  );
});

it('never displays unknown server text, HTML, tokens, or stack traces', () => {
  const message =
    '<html>Authorization: Bearer PRIVATE_TEST_VALUE\nseed words and stack trace</html>';
  for (const service of ['cashu', 'routstr', 'nostr', 'nagg', 'app'] as const) {
    const shown = describeError(new Error(message), service);
    expect(shown.id).toBe(`${service}.unknown`);
    expect(shown.text).not.toMatch(/PRIVATE_TEST_VALUE|seed words|<html>|stack trace/);
  }
});

it('handles cyclic and unreadable error envelopes without crashing error UI', () => {
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;
  expect(describeError(cyclic, 'cashu').id).toBe('cashu.unknown');
  expect(
    describeError(
      {
        get message() {
          throw new Error('bad getter');
        },
      },
      'cashu'
    ).id
  ).toBe('cashu.unknown');
});

it('keeps mixed aggregate failures generic instead of picking one child as the whole outcome', () => {
  expect(
    describeError(
      new AggregateError(
        [
          { code: 11001, detail: 'spent' },
          { code: 11002, detail: 'pending' },
        ],
        'multiple failures'
      ),
      'cashu'
    ).id
  ).toBe('cashu.unknown');
});

it.each([
  ['lnd is not ready for payments', 'cashu.lightning_unavailable'],
  ['invoice expired', 'cashu.quote_expired'],
  ['outputs have already been signed before', 'cashu.outputs_signed'],
  ['mint quote already issued', 'cashu.quote_issued'],
  ['witness is missing for p2pk', 'cashu.signature'],
  ['lightning payment failed', 'cashu.lightning_failed'],
])('retains safe mappings for legacy string errors: %s', (message, id) => {
  expect(describeError(new Error(message), 'cashu').id).toBe(id);
});

it('understands the installed Coco and cashu-ts error constructors', () => {
  const mintError = new MintOperationError(11001, 'vendor detail');
  for (const error of [
    mintError,
    new MintFetchError('https://mint.invalid', undefined, mintError),
    new ProofOperationError('https://mint.invalid', undefined, 'test-keyset', mintError),
  ]) {
    expect(describeError(error, 'cashu').id).toBe('cashu.proofs_spent');
  }
  expect(describeError(new OperationInProgressError('test-operation'), 'cashu').id).toBe(
    'cashu.operation_pending'
  );
  expect(describeError(new AuthSessionExpiredError('https://mint.invalid'), 'cashu').id).toBe(
    'cashu.auth'
  );
});

it('prefers HTTP evidence over legacy prose or a generic SDK wrapper', () => {
  expect(describeError({ status: 503, message: 'insufficient funds' }, 'cashu').id).toBe(
    'cashu.unavailable'
  );
  expect(
    describeError(new Error('Auth session failed', { cause: { status: 504 } }), 'cashu').id
  ).toBe('cashu.timeout');
  expect(describeError({ status: 401, error: { code: 'model_not_found' } }, 'routstr').id).toBe(
    'routstr.auth'
  );
});
