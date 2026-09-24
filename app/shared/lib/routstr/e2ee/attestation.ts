import { Verifier } from '@tinfoilsh/verifier';

import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import type { RequestControls } from 'wallet/safeFetch';
import { apiLog } from '@/shared/lib/logger';

/**
 * Enclave attestation for Tinfoil's TEE-hosted models.
 *
 * The security property is not "the body was encrypted" — it is "the body was
 * encrypted to a key that only a measured, signed enclave holds". Skipping
 * verification and trusting a key the network handed us would produce working
 * requests with none of the guarantee, so `attestEnclave` is the only source
 * of an HPKE key in this module and it never returns an unverified one.
 *
 * Two independent checks run inside `verifyBundle`:
 *   - the AMD SEV-SNP report chains to AMD's root key, binding the HPKE key to
 *     real confidential-computing hardware running the measured image;
 *   - the release is signed, via Sigstore, by a workflow in `CONFIG_REPO`.
 *
 * `crypto.subtle` (RSA-PSS for AMD's chain, ECDSA for the report and Sigstore)
 * comes from `react-native-quick-crypto`, installed and asserted in `shim.js`
 * before any module loads.
 */

/**
 * Tinfoil's attestation collection service. Deliberately NOT the routstr
 * node's `/attestation` proxy: that proxy is a convenience for clients which
 * cannot reach the ATC, and asking the party we are hiding the prompt from to
 * supply the key we hide it with is the wrong default. (The proxy on the node
 * the app currently uses was returning 502 when this was written.)
 */
const ATTESTATION_BUNDLE_URL = 'https://atc.tinfoil.sh/attestation';

/**
 * The GitHub repository whose signed releases may run in the enclave. This is
 * a security parameter, not configuration: it is the thing that stops a
 * validly-attested enclave running somebody else's image. Verification fails
 * closed on a mismatch.
 */
const CONFIG_REPO = 'tinfoilsh/confidential-model-router';

/**
 * How long one verified attestation may be reused.
 *
 * The ATC round-robins across enclaves and each has its own HPKE key, so a
 * cached key is a cached *enclave*, not a cached decision. Short enough that a
 * rotated or retired enclave is not addressed for long; long enough that a
 * conversation does not re-verify on every turn.
 */
const ATTESTATION_TTL_MS = 10 * 60 * 1000;

interface AttestedEnclave {
  /** Hex X25519 public key the request body is sealed to. */
  hpkePublicKey: string;
  /** Measurement fingerprint of the code the enclave is running. */
  measurement: string;
  verifiedAt: number;
}

let cached: AttestedEnclave | null = null;
let inFlight: Promise<AttestedEnclave> | null = null;

/** Drop the cached attestation. Called when the enclave rejects our key
 *  configuration, which means it rotated underneath us. */
export function invalidateAttestation(): void {
  cached = null;
}

async function fetchAndVerify(controls: RequestControls): Promise<AttestedEnclave> {
  const started = Date.now();
  // The attestation bundle is an opaque third-party structure handed straight
  // to the verifier. Routing it through `fetchJson` would mean inventing a zod
  // envelope for a shape we do not own, which could only drift.
  // eslint-disable-next-line no-restricted-globals -- see the note above
  const response = await fetch(ATTESTATION_BUNDLE_URL, {
    signal: buildAbortSignal({ timeoutMs: 20_000, ...controls }),
  });
  if (!response.ok) {
    throw new Error(`attestation bundle unavailable (HTTP ${response.status})`);
  }
  const bundle = await response.json();
  const verifier = new Verifier({ configRepo: CONFIG_REPO });
  const verified = await verifier.verifyBundle(bundle);
  if (!verified.hpkePublicKey) {
    throw new Error('attestation carried no HPKE public key');
  }
  const attested: AttestedEnclave = {
    hpkePublicKey: verified.hpkePublicKey,
    measurement: verified.measurement?.registers?.[0] ?? '',
    verifiedAt: Date.now(),
  };
  apiLog.info('routstr.e2ee.attested', {
    durationMs: Date.now() - started,
    // The measurement identifies the code, not the user. Logging it is what
    // makes "which enclave answered" answerable after the fact.
    measurement: attested.measurement.slice(0, 16),
  });
  return attested;
}

/**
 * A verified enclave, from cache when fresh. Concurrent callers share one
 * verification; a failed one is never cached, so the next send retries rather
 * than inheriting a rejection.
 */
export async function attestEnclave(controls: RequestControls = {}): Promise<AttestedEnclave> {
  if (cached && Date.now() - cached.verifiedAt < ATTESTATION_TTL_MS) return cached;
  if (inFlight) return inFlight;
  inFlight = fetchAndVerify(controls)
    .then((attested) => {
      cached = attested;
      return attested;
    })
    .catch((error) => {
      apiLog.warn('routstr.e2ee.attestation_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
