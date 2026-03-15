/**
 * Sovran payment string processor.
 *
 * Resolver-runtime wrapper with built-in UR assembly:
 *   - executes coco-payment-ux resolver for parsed inputs
 *   - routes outcomes via centralized handlers
 *   - keeps UR haptics/progress behavior
 */

import { useCallback, useRef, useState } from 'react';

import { router } from 'expo-router';
import { URDecoder } from '@gandlaf21/bc-ur';

import { usePaymentFlowMachine } from '@/features/send/providers/PaymentFlowProvider';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import Haptics from '@/shared/ui/primitives/Haptics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanningData {
  data: string;
  type?: string;
}

interface UseProcessPaymentStringProps {
  unit: string;
  selectedMint: string | undefined;
  isFocused?: boolean;
  onProgress?: (progress: number) => void;
  onLoading?: (loading: boolean) => void;
  onScanned?: (scanned: boolean) => void;
  onUnlockCamera?: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useProcessPaymentString = ({
  unit,
  selectedMint,
  isFocused = true,
  onProgress,
  onLoading,
  onScanned,
  onUnlockCamera,
}: UseProcessPaymentStringProps) => {
  const walletContext = useWalletContextWithOverride(selectedMint);
  const [urDecoder, setUrDecoder] = useState(() => new URDecoder());
  const processedRef = useRef(false);

  const machine = usePaymentFlowMachine({
    walletContext,
    unit,
    onOptionDismiss: () => {
      onLoading?.(false);
      onUnlockCamera?.();
      processedRef.current = false;
    },
  });

  const processPaymentString = useCallback(
    async (
      scanning: ScanningData
    ): Promise<{ urInProgress: boolean; progress?: number; lockedPending?: boolean }> => {
      if (!isFocused) {
        return { urInProgress: false };
      }

      onLoading?.(true);
      onScanned?.(true);

      if (scanning.data.startsWith('ur:') || scanning.data.startsWith('UR:')) {
        const prevProgress = urDecoder.getProgress();
        urDecoder.receivePart(scanning.data);
        const nextProgress = urDecoder.getProgress();

        if (nextProgress !== prevProgress) {
          onProgress?.(nextProgress);
          if (nextProgress < 0.33) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } else if (nextProgress < 0.66) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } else if (nextProgress < 1) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          } else {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        }

        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          const decoded = urDecoder.resultUR().decodeCBOR();
          const decodedString = new TextDecoder().decode(decoded);
          onLoading?.(false);
          router.navigate({
            pathname: '/(receive-flow)/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(decodedString)),
            },
          });
          return { urInProgress: false };
        }

        return { urInProgress: true, progress: nextProgress };
      }

      if (processedRef.current) {
        return { urInProgress: false };
      }

      processedRef.current = true;
      await machine.send({ type: 'EXECUTE', input: scanning.data });
      const state = machine.inspect();

      if (state.status !== 'needsInput' || state.code !== 'OPTION_SELECTION_REQUIRED') {
        onLoading?.(false);
        onProgress?.(0);
        processedRef.current = false;
      }

      return {
        urInProgress: false,
        lockedPending: state.status === 'needsInput' && state.code === 'OPTION_SELECTION_REQUIRED',
      };
    },
    [isFocused, onLoading, onScanned, urDecoder, onProgress, machine]
  );

  const reset = useCallback(() => {
    machine.reset();
    processedRef.current = false;
    setUrDecoder(new URDecoder());
    onProgress?.(0);
    onLoading?.(false);
  }, [machine, onProgress, onLoading]);

  return { processPaymentString, reset };
};
