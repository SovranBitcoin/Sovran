import { Identity, PROTOCOL, decryptResponseWithToken, extractSessionRecoveryToken } from 'ehbp';

/**
 * EHBP framing for a Routstr chat completion.
 *
 * The node is a blind relay here — `routstr/upstream/ehbp.py` contains no
 * cryptography at all. It reads the plaintext `X-Routstr-Model` header to bill
 * and route, and forwards the sealed bytes to the enclave untouched. So the
 * whole client contract is: seal the body to the attested key, name the model
 * in a header, and decrypt what comes back.
 *
 * `Identity.encryptRequestWithContext` returns a `Request` carrying
 * `duplex: 'half'`, which React Native's fetch polyfill does not support. That
 * only matters if the sealed `Request` is handed to `fetch` — so it is not.
 * Its bytes and its one header are read back out and the caller issues an
 * ordinary request with a `Uint8Array` body, which RN does support. The
 * alternative, resealing at byte level, would mean reaching into `Identity`'s
 * private cipher suite; the framing is simple (4-byte big-endian length, then
 * one HPKE `Seal` of the body) but it is the library's to change, not ours.
 */

/** The framed request bytes plus the context needed to open the reply. */
export interface SealedRequest {
  /** Framed ciphertext, ready to hand straight to `fetch`. */
  body: ArrayBuffer;
  headers: Record<string, string>;
  /** Opaque to callers; hand it back to `openResponse`. */
  context: unknown;
}

/**
 * Seal `payload` to an attested enclave key.
 *
 * `modelId` is the BARE upstream id — the enclave does not know the catalog's
 * `tinfoil-` namespace. The prefixed id belongs in `X-Routstr-Model`, which
 * the caller sets, because that is what the node bills.
 */
export async function sealRequest(hpkePublicKey: string, payload: unknown): Promise<SealedRequest> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const identity = await Identity.fromPublicKeyHex(hpkePublicKey);
  const request = new Request('https://enclave.invalid/v1/chat/completions', {
    method: 'POST',
    body: plaintext,
  });
  const { request: sealed, context } = await identity.encryptRequestWithContext(request);
  const body = await sealed.arrayBuffer();
  const encapsulatedKey = sealed.headers.get(PROTOCOL.ENCAPSULATED_KEY_HEADER);
  if (!encapsulatedKey) throw new Error('ehbp: no encapsulated key on the sealed request');
  return {
    body,
    headers: { [PROTOCOL.ENCAPSULATED_KEY_HEADER]: encapsulatedKey },
    context,
  };
}

/** True when the enclave answered. A response WITHOUT the nonce header is a
 *  plaintext one the node produced before the request ever reached the
 *  enclave — a 402, a 401, a rate limit — and must be read as-is, not
 *  decrypted, or its real status and body are lost. */
export function isSealedResponse(response: Response): boolean {
  return response.headers.get(PROTOCOL.RESPONSE_NONCE_HEADER) != null;
}

/** True when the enclave rejected our key configuration, i.e. it rotated
 *  underneath us. The caller should re-attest once and retry. */
export function isKeyConfigMismatch(response: Response): boolean {
  if (response.status !== 422) return false;
  const type = response.headers.get('content-type') ?? '';
  return type.includes(PROTOCOL.PROBLEM_JSON_MEDIA_TYPE);
}

/** Decrypt an enclave response into an ordinary `Response`. Its body is a
 *  normal SSE stream; nothing about EHBP changes how it is parsed. */
export async function openResponse(response: Response, context: unknown): Promise<Response> {
  const token = await extractSessionRecoveryToken(context as never);
  return decryptResponseWithToken(response, token);
}
