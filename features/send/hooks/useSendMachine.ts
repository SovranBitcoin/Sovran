import { useCallback, useMemo } from 'react';

import { useSendMachineStore } from '../store/sendMachineStore';
import type { Denomination } from '../machine/sendMachine.types';

/**
 * Zero-config hook for the standalone send machine.
 *
 * Usage from any component:
 * ```ts
 * const send = useSendMachine();
 * send.setAmount(100);
 * send.next();
 * ```
 */
export function useSendMachine() {
  const snapshot = useSendMachineStore((s) => s.snapshot);
  const send = useSendMachineStore((s) => s.send);
  const reset = useSendMachineStore((s) => s.reset);

  const next = useCallback(() => send({ type: 'NEXT' }), [send]);
  const cancel = useCallback(() => send({ type: 'CANCEL' }), [send]);
  const retry = useCallback(() => send({ type: 'RETRY' }), [send]);
  const roundUp = useCallback(() => send({ type: 'ROUND_UP' }), [send]);
  const roundDown = useCallback(() => send({ type: 'ROUND_DOWN' }), [send]);

  const setAmount = useCallback(
    (amountSat: number, fiatAmount?: number | null) =>
      send({ type: 'SET_AMOUNT', amountSat, fiatAmount }),
    [send]
  );

  const setDenomination = useCallback(
    (denomination: Denomination) => send({ type: 'SET_DENOMINATION', denomination }),
    [send]
  );

  const setMint = useCallback((mintUrl: string) => send({ type: 'SET_MINT', mintUrl }), [send]);

  const selectMint = useCallback(
    (mintUrl: string) => send({ type: 'MINT_SELECTED', mintUrl }),
    [send]
  );

  return useMemo(
    () => ({
      // Raw state
      state: snapshot.value,
      context: snapshot.context,

      // Phase flags
      isEditingAmount: snapshot.matches('editingAmount'),
      isValidatingBalance: snapshot.matches('validatingBalance'),
      isMintSelect: snapshot.matches('mintSelect'),
      isCheckingConnectivity: snapshot.matches('checkingConnectivity'),
      isOnlineSending: snapshot.matches('onlineSend'),
      isOfflineResolving: snapshot.matches('offlineResolution'),
      isAdjustmentPrompt: snapshot.matches('adjustmentPrompt'),
      isSendingToken: snapshot.matches('sendingToken'),
      isSuccess: snapshot.matches('success'),
      isFailure: snapshot.matches('failure'),

      // Derived convenience values
      error: snapshot.context.error,
      token: snapshot.context.token,
      operationId: snapshot.context.operationId,
      historyEntryJson: snapshot.context.historyEntryJson,
      offlineSuggestions: snapshot.context.offlineSuggestions,
      fiatOfflineSuggestions: snapshot.context.fiatOfflineSuggestions,

      // Commands
      next,
      cancel,
      retry,
      roundUp,
      roundDown,
      setAmount,
      setDenomination,
      setMint,
      selectMint,
      reset,
    }),
    [
      snapshot,
      next,
      cancel,
      retry,
      roundUp,
      roundDown,
      setAmount,
      setDenomination,
      setMint,
      selectMint,
      reset,
    ]
  );
}
