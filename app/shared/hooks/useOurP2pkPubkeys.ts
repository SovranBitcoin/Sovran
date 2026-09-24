/**
 * The P2PK public keys this wallet can sign for.
 *
 * Public keys only. "Can I take this back?" is answered by comparing pubkeys,
 * so the private half never has to be in app memory to answer it.
 *
 * `undefined` while unresolved is meaningful and is passed through as such:
 * it is not the same as "we hold none", and the lock model reports an unknown
 * reclaim verdict rather than claiming we cannot.
 */

import { useManagerContext } from '@cashu/coco-react';
import { resolveReceiveP2PKPublicKeys } from '@sovranbitcoin/coco-cashu-plugin-p2pk-import';
import { useEffect, useState } from 'react';

import { paymentLog } from '@/shared/lib/logger';

export function useOurP2pkPubkeys(): readonly string[] | undefined {
  // Not `useManager()`: that throws before the wallet is ready, and these
  // screens open from route params, including on a cold start.
  const { manager } = useManagerContext();
  const [resolved, setResolved] = useState<{
    owner: typeof manager;
    keys: readonly string[];
  } | null>(null);

  useEffect(() => {
    if (!manager) return;
    let cancelled = false;
    void resolveReceiveP2PKPublicKeys(manager)
      .then((keys) => {
        if (!cancelled) setResolved({ owner: manager, keys });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        paymentLog.warn('send.conditions.keysUnavailable', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [manager]);

  return resolved && resolved.owner === manager ? resolved.keys : undefined;
}
