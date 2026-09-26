import { useEffect } from 'react';
import { useShallow } from 'zustand/shallow';

import { selectMintLiveness, type MintLiveness } from '@/features/mint/lib/mintLiveness';
import { probeMints } from '@/shared/lib/cashu/mintHealth';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';

/**
 * The dot for each mint on screen, keyed by normalized mint URL, from the
 * store on the first frame — the last probe, nagg's verdict, or the
 * auditor's state as a proxy — while a background sweep of `/v1/info`
 * brings the stale ones up to date. Feed it the rows on screen (the
 * selector's list, the discovery list's visible window).
 */
export function useMintPresence(
  mintUrls: readonly string[],
  enabled = true
): Record<string, MintLiveness> {
  // Only real mint URLs; skeleton rows carry synthetic keys.
  const probeUrls = mintUrls.filter((url) => url.startsWith('https://'));
  const probeKey = probeUrls.map(normalizeMintUrlKey).sort().join('\u0000');

  const presence = useMintMetadataStore(
    useShallow((state) => {
      const out: Record<string, MintLiveness> = {};
      for (const url of probeUrls) {
        const key = normalizeMintUrlKey(url);
        out[key] = selectMintLiveness(state.byMintUrl[key]);
      }
      return out;
    })
  );

  useEffect(() => {
    if (!enabled || probeKey.length === 0) return;
    const controller = new AbortController();
    // `probeMints` reports fresh verdicts from the store and only dials the
    // rest; every answer lands in the store, which the selector above reads.
    void probeMints(
      probeKey.split('\u0000').map((key) => `https://${key}`),
      {
        signal: controller.signal,
        onResult: () => {},
      }
    );
    return () => controller.abort();
  }, [probeKey, enabled]);

  return presence;
}
