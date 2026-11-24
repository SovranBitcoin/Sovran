/**
 * The spending fee per unit of one mint (NUT-02 `input_fee_ppk` of its active
 * keysets), for Mint Info's fee pills.
 *
 * A mint in the wallet is answered from Coco's saved keysets (no network). A
 * mint not in the wallet, or one Coco holds no keysets for yet, is asked
 * directly (`GET /v1/keysets`, https only, cancelled with the page). Nothing
 * waits on it: until it answers, and when it cannot, there are no fee pills.
 */
import { useEffect, useState } from 'react';
import { useManager } from '@cashu/coco-react';

import { activeInputFees, type UnitInputFee } from '@/features/mint/lib/mintCapabilities';
import { fetchMintKeysets } from '@/shared/lib/apiClient';
import { getMintKeysetFees } from '@/shared/lib/cashu/managerInternals';
import { cashuLog } from '@/shared/lib/logger';

const KEYSETS_TIMEOUT_MS = 8_000;

export function useMintInputFees(mintUrl: string, isTrusted: boolean): UnitInputFee[] | undefined {
  const manager = useManager();
  const [fees, setFees] = useState<{ mintUrl: string; fees: UnitInputFee[] } | undefined>();

  useEffect(() => {
    if (!mintUrl) return;
    const controller = new AbortController();
    const publish = (next: UnitInputFee[]) => {
      if (!controller.signal.aborted && next.length > 0) setFees({ mintUrl, fees: next });
    };
    void (async () => {
      if (isTrusted && manager) {
        try {
          const local = activeInputFees(await getMintKeysetFees(manager, mintUrl));
          if (local.length > 0) {
            publish(local);
            return;
          }
        } catch (error) {
          cashuLog.debug('mint.info.fees.local_failed', {
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
      if (controller.signal.aborted) return;
      const remote = await fetchMintKeysets(mintUrl, {
        signal: controller.signal,
        timeoutMs: KEYSETS_TIMEOUT_MS,
      });
      if (remote.isOk()) publish(activeInputFees(remote.value.keysets));
    })();
    return () => controller.abort();
  }, [mintUrl, isTrusted, manager]);

  // Read for this mint only, so a page reused for another mint never shows the first one's fees.
  return fees?.mintUrl === mintUrl ? fees.fees : undefined;
}
