import { useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { useManager } from 'coco-cashu-react';
import { buildExactOfflineAmountIndex } from '@/features/send/lib/offlineSendSuggestions';
import type { OfflineSendabilityState } from './types';

export function useOfflineSendability(
  isSendTokenFlow: boolean,
  selectedMint: string | undefined,
  mintBalance: number
): OfflineSendabilityState | null {
  const manager = useManager();
  const [state, setState] = useState<OfflineSendabilityState | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!isSendTokenFlow || !selectedMint || mintBalance <= 0) {
      setState(null);
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setState(null);

    const interaction = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const readyProofs = await manager.proofService.getReadyProofs(selectedMint);
          const index = buildExactOfflineAmountIndex(readyProofs.map((p) => p.amount));

          if (cancelled || requestIdRef.current !== requestId) return;

          setState({
            reachableSums: index.reachableSums,
            reachableAmounts: new Set(index.reachableSums),
            totalReadyBalance: index.totalReadyBalance,
          });
        } catch {
          if (!cancelled && requestIdRef.current === requestId) {
            setState(null);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      interaction.cancel();
    };
  }, [manager, mintBalance, isSendTokenFlow, selectedMint]);

  return state;
}
