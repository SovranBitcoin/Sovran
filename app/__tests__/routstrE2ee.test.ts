/**
 * EHBP transport for Tinfoil's TEE models.
 *
 * Two properties matter more than the happy path and are pinned here:
 *
 *  1. E2EE is decided by the `tinfoil-` ID PREFIX, never by a display name.
 *     The live catalog lists `glm-5-3` and `tinfoil-glm-5-3` with identical
 *     pricing and the identical name "Private (E2EE) GLM 5.3"; only the
 *     prefixed one is sealed. Keying anything on the name would label a
 *     plaintext request end-to-end encrypted.
 *  2. A node-side error arrives in PLAINTEXT, with no response nonce, because
 *     it never reached the enclave. Decrypting unconditionally throws and
 *     takes the real status and body with it — which is precisely the
 *     402/401 handling the rest of the client depends on.
 */

import { isTinfoilModel, tinfoilUpstreamModelId } from '@/shared/lib/routstr/e2ee/tinfoilModels';

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
    aiLog: noop,
    storeLog: noop,
    log: noop,
    applyFileLogging: jest.fn(),
    redactError: (e: unknown) => e,
  };
});

jest.mock('@/shared/lib/http/requestSignal', () => ({
  DEFAULT_TIMEOUT_MS: 10_000,
  buildAbortSignal: () => undefined,
}));

jest.mock('@/shared/lib/routstr/payment', () => ({
  mintRequestPayment: jest.fn(async (amountSats: number) => ({
    encoded: 'cashuB-request-payment',
    operationId: 'op-1',
    mintUrl: 'https://mint.example',
    amountSats,
  })),
  receiveChange: jest.fn(async () => undefined),
  reclaimUnspentPayment: jest.fn(async () => undefined),
}));

describe('tinfoil model identity', () => {
  it('keys E2EE on the id prefix, not the display name', () => {
    expect(isTinfoilModel('tinfoil-glm-5-3')).toBe(true);
    // Same name and price as its sealed twin on the live catalog, but the
    // node reads this one in the clear.
    expect(isTinfoilModel('glm-5-3')).toBe(false);
    expect(isTinfoilModel('claude-haiku-4.5')).toBe(false);
    expect(isTinfoilModel('')).toBe(false);
  });

  it('strips the catalog namespace for the enclave and leaves other ids alone', () => {
    // The enclave knows `glm-5-2`; `tinfoil-` is the routstr catalog's
    // namespace and travels separately in X-Routstr-Model.
    expect(tinfoilUpstreamModelId('tinfoil-glm-5-2')).toBe('glm-5-2');
    expect(tinfoilUpstreamModelId('tinfoil-TEE-deepseek-v4-flash')).toBe('TEE-deepseek-v4-flash');
    expect(tinfoilUpstreamModelId('claude-haiku-4.5')).toBe('claude-haiku-4.5');
  });
});

describe('EHBP response classification', () => {
  // Imported lazily so the module graph above is mocked first.
  const load = () => require('@/shared/lib/routstr/e2ee/ehbpTransport');

  const withHeaders = (status: number, headers: Record<string, string>) =>
    new Response('{}', { status, headers });

  it('treats a response without the nonce header as plaintext', () => {
    const { isSealedResponse } = load();
    // What a 402 from the node looks like: it never reached the enclave.
    expect(isSealedResponse(withHeaders(402, { 'content-type': 'application/json' }))).toBe(false);
  });

  it('treats a response carrying the nonce header as sealed', () => {
    const { isSealedResponse } = load();
    expect(isSealedResponse(withHeaders(200, { 'Ehbp-Response-Nonce': 'abc' }))).toBe(true);
  });

  it('recognises a key rotation only on 422 problem+json', () => {
    const { isKeyConfigMismatch } = load();
    expect(
      isKeyConfigMismatch(withHeaders(422, { 'content-type': 'application/problem+json' }))
    ).toBe(true);
    // A plain 422 from somewhere else must not trigger a re-attest loop.
    expect(isKeyConfigMismatch(withHeaders(422, { 'content-type': 'application/json' }))).toBe(
      false
    );
    expect(
      isKeyConfigMismatch(withHeaders(402, { 'content-type': 'application/problem+json' }))
    ).toBe(false);
  });
});

describe('sendMessage over EHBP', () => {
  // A real X25519 public key, as served by Tinfoil's attestation. Attestation
  // itself is stubbed (it is network + signature verification, covered by the
  // verifier's own suite); everything below it is the real `ehbp` seal.
  const ENCLAVE_KEY = '1c6bbc5e56812bf48fccafb62b96ad4aa3938c012767d8e875d07cb8ed191e06';

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('@/shared/lib/routstr/e2ee/attestation', () => ({
      attestEnclave: jest.fn(async () => ({
        hpkePublicKey: ENCLAVE_KEY,
        measurement: 'test',
        verifiedAt: Date.now(),
      })),
      invalidateAttestation: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.dontMock('@/shared/lib/routstr/e2ee/attestation');
  });

  const captureRequest = (response: Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    // eslint-disable-next-line no-restricted-properties -- test seam for the sealed request
    global.fetch = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return response;
    }) as unknown as typeof fetch;
    return calls;
  };

  it('seals the body and names the model out of band', async () => {
    const { sendMessage } = require('@/shared/lib/routstr/api');
    const calls = captureRequest(
      new Response('data: [DONE]\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    await sendMessage([{ role: 'user', content: 'a secret prompt' }], {
      model: 'tinfoil-glm-5-2',
      paymentSats: 10,
      max_tokens: 4096,
    });

    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, string>;
    // The node bills and routes on the prefixed id in a plaintext header; it
    // cannot read the body to find one.
    expect(headers['X-Routstr-Model']).toBe('tinfoil-glm-5-2');
    expect(headers['Ehbp-Encapsulated-Key']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['Content-Type']).toBe('application/octet-stream');

    const body = calls[0].init.body;
    expect(typeof body).not.toBe('string');
    // The prompt must not survive anywhere in the bytes on the wire.
    const bytes = new Uint8Array(body as ArrayBuffer);
    expect(new TextDecoder().decode(bytes)).not.toContain('a secret prompt');
    expect(new TextDecoder().decode(bytes)).not.toContain('tinfoil-glm-5-2');
  });

  it('sends an unsealed JSON body for a model that is not E2EE', async () => {
    const { sendMessage } = require('@/shared/lib/routstr/api');
    const calls = captureRequest(
      new Response('data: [DONE]\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    );

    await sendMessage([{ role: 'user', content: 'hi' }], {
      model: 'claude-haiku-4.5',
      paymentSats: 10,
    });

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Routstr-Model']).toBeUndefined();
    expect(headers['Ehbp-Encapsulated-Key']).toBeUndefined();
    expect(String(calls[0].init.body)).toContain('claude-haiku-4.5');
  });

  it('surfaces a plaintext node error on the sealed path with its real status', async () => {
    const { sendMessage } = require('@/shared/lib/routstr/api');
    // The node refuses before the request reaches the enclave, so there is no
    // response nonce. Decrypting would throw and lose the 402.
    captureRequest(
      new Response(
        JSON.stringify({
          error: {
            message: 'Insufficient balance: 85577 mSats required. 216 available.',
            type: 'insufficient_quota',
            code: 'insufficient_balance',
          },
        }),
        { status: 402, headers: { 'content-type': 'application/json' } }
      )
    );

    await expect(
      sendMessage([{ role: 'user', content: 'hi' }], { model: 'tinfoil-glm-5-2', paymentSats: 10 })
    ).rejects.toMatchObject({
      status: 402,
      error: { code: 'insufficient_balance', details: { required: 85577, available: 216 } },
    });
  });
});
