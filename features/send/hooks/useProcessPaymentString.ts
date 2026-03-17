/**
 * Sovran payment string processor — thin wrapper around coco-payment-ux.
 *
 * Injects Sovran-specific concerns:
 *   - UR decoder library (@gandlaf21/bc-ur)
 *   - Haptic feedback on UR assembly progress
 *   - Navigation to receive token screen on UR completion
 */

import { router } from 'expo-router';
import { URDecoder } from '@gandlaf21/bc-ur';

import { usePaymentStringProcessor } from 'coco-payment-ux/react';

import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import { useWalletContextWithOverride } from '@/shared/providers/WalletContextProvider';
import Haptics from '@/shared/ui/primitives/Haptics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  return usePaymentStringProcessor({
    walletContext,
    unit,
    isFocused,
    createURDecoder: () => new URDecoder(),
    onReceiveUR: (decodedString) => {
      onLoading?.(false);
      router.navigate({
        pathname: '/(receive-flow)/receiveToken',
        params: {
          receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(decodedString)),
        },
      });
    },
    onProgress: (progress) => {
      onProgress?.(progress);
      if (progress < 0.33) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else if (progress < 0.66) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } else if (progress < 1) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    },
    onLoading,
    onScanned,
    onUnlockCamera,
  });
};
