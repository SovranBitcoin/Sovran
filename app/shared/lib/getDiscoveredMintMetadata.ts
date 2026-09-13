import type { RequestControls } from 'wallet';

import { discoverMint } from '@/shared/lib/apiClient';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';

/** Host-scoped display metadata. Freshness never establishes spendability or a route. */
export async function getDiscoveredMintMetadata(mintUrl: string, controls?: RequestControls) {
  const store = useMintMetadataStore.getState();
  const cached = store.getCached(mintUrl);
  if (!store.isStale(mintUrl, 'audit') || controls?.signal?.aborted) return cached;

  const result = await discoverMint(mintUrl, controls);
  if (controls?.signal?.aborted) return cached;
  if (result.isOk() && result.value) {
    useMintMetadataStore.getState().upsertFromDiscover([result.value]);
    return useMintMetadataStore.getState().getCached(mintUrl);
  }
  return cached;
}
