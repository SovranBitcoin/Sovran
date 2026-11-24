/**
 * The NUT-02 fee redeeming a token will pay, from the keysets Coco already
 * saved for its mint (local DB, no network, no wallet or counter change).
 * `undefined` until known, and whenever it cannot be known — a mint not in the
 * wallet, a keyset not saved, a read that fails — so the screen shows nothing.
 */
import { useEffect, useState } from 'react';
import { useManager } from '@cashu/coco-react';

import { tokenReceiveFee } from '@/features/receive/lib/tokenReceiveFee';
import { getMintKeysetFees } from '@/shared/lib/cashu/managerInternals';
import { paymentLog } from '@/shared/lib/logger';

export function useTokenReceiveFee(
  mintUrl: string | undefined,
  token: string | undefined
): number | undefined {
  const manager = useManager();
  const [result, setResult] = useState<{ key: string; fee: number | undefined }>();
  const key = mintUrl && token ? `${mintUrl}|${token}` : undefined;

  useEffect(() => {
    if (!key || !mintUrl || !token || !manager) return;
    let live = true;
    void getMintKeysetFees(manager, mintUrl)
      .then((keysets) => {
        if (live) setResult({ key, fee: tokenReceiveFee(token, keysets) });
      })
      .catch((error: unknown) => {
        paymentLog.debug('receive.token.fee_unavailable', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    return () => {
      live = false;
    };
  }, [key, mintUrl, token, manager]);

  // Only the answer for this token, never one left from a previous entry.
  return result?.key === key ? result?.fee : undefined;
}
