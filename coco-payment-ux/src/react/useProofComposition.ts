// ---------------------------------------------------------------------------
// useProofComposition — memoized proof composition analysis
//
// Thin React wrapper around composeSatoshis. The wallet provides proof
// amounts and a target; the hook returns the composition result. The
// wallet then decides the UX: round up/down suggestions, proof picker,
// auto-adjust, etc.
// ---------------------------------------------------------------------------

import { useMemo } from 'react';

import { composeSatoshis } from '../offline';
import type { CompositionResult } from '../types';

export interface UseProofCompositionConfig {
  proofAmounts: number[];
  targetAmount: number;
  enabled?: boolean;
}

export function useProofComposition(config: UseProofCompositionConfig): CompositionResult | null {
  const { proofAmounts, targetAmount, enabled = true } = config;

  return useMemo(() => {
    if (!enabled || targetAmount <= 0 || proofAmounts.length === 0) {
      return null;
    }
    return composeSatoshis(proofAmounts, targetAmount);
  }, [proofAmounts, targetAmount, enabled]);
}
