import { OutputData, type OutputDataCreator } from '@cashu/cashu-ts';

type CashuCryptoBackend = 'cashu-ts' | 'cdk';

// Source-controlled release gate. Enable CDK only after integrating official bindings.
const CASHU_CRYPTO_BACKEND: CashuCryptoBackend = 'cashu-ts';

export function resolveOutputDataCreator(
  backend: CashuCryptoBackend = CASHU_CRYPTO_BACKEND
): OutputDataCreator {
  if (backend === 'cdk') {
    throw new Error('Official CDK bindings are not integrated; use the cashu-ts backend.');
  }
  return OutputData;
}
