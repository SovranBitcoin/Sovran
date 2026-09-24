/**
 * Which catalog rows are end-to-end encrypted, and what the enclave calls them.
 *
 * The ONLY sound test is the `tinfoil-` id prefix. A node's `/v1/models` rows
 * carry an operator-authored `name`, and the live catalog lists several models
 * twice under one name — `glm-5-3` and `tinfoil-glm-5-3`, identical pricing,
 * both displayed "Private (E2EE) GLM 5.3". Only the prefixed id is routed
 * through EHBP; the twin is a plaintext request the node can read. Keying any
 * privacy affordance on the display name would label the plaintext twin as
 * end-to-end encrypted, which `CLAIMS.md` forbids.
 *
 * Mirrors `isTinfoilModel` in routstr-sdk (`client/TinfoilSecure.ts`) and the
 * node's own `TINFOIL_MODEL_PREFIX` (`routstr/upstream/ehbp.py`).
 */
const TINFOIL_MODEL_PREFIX = 'tinfoil-';

/** True when this model id must travel sealed to an attested enclave. */
export function isTinfoilModel(modelId: string): boolean {
  return modelId.startsWith(TINFOIL_MODEL_PREFIX);
}

/**
 * The model id the enclave expects inside the sealed body.
 *
 * The `tinfoil-` namespace belongs to the routstr catalog, not to Tinfoil: the
 * enclave knows the bare id. The prefixed id still travels in the plaintext
 * `X-Routstr-Model` header, which is what the node bills and routes on.
 */
export function tinfoilUpstreamModelId(modelId: string): string {
  return isTinfoilModel(modelId) ? modelId.slice(TINFOIL_MODEL_PREFIX.length) : modelId;
}
