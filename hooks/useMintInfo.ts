import { useState, useEffect } from 'react';

import type { MintInfo } from '@cashu/cashu-ts';

import { useMintManagement } from '@/hooks/coco/useMintManagement';

/**
 * Loads mint info for a given mint URL.
 *
 * - Returns `null` while loading or if the URL is absent/errored.
 * - Automatically re-fetches when the URL changes.
 * - Does NOT throw on network errors; silently falls back to null.
 */
export function useMintInfo(mintUrl: string | undefined | null): MintInfo | null {
  const { getMintInfo } = useMintManagement();
  const [mintInfo, setMintInfo] = useState<MintInfo | null>(null);

  useEffect(() => {
    if (!mintUrl) {
      setMintInfo(null);
      return;
    }
    let mounted = true;
    getMintInfo(mintUrl)
      .then((info) => {
        if (mounted) setMintInfo(info as MintInfo);
      })
      .catch(() => {
        if (mounted) setMintInfo(null);
      });
    return () => {
      mounted = false;
    };
  }, [mintUrl, getMintInfo]);

  return mintInfo;
}
