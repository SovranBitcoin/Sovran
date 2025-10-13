import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { URDecoder } from '@gandlaf21/bc-ur';
import Haptics from 'components/ui/Haptics';
import { useMelt } from '@/hooks/coco';
import { getDecodedToken, ReceiveHistoryEntry } from 'coco-cashu-core';
import { Proof } from '@cashu/cashu-ts';
import {
  getLightningAmount,
  isLightningInvoice,
  isValidEcashToken,
  lnTrim,
} from '@/helper/coco/utils';
import { utils as lnurlPayUtils } from 'lnurl-pay';

interface ScanningData {
  data: string;
  type?: string;
}

interface UseProcessPaymentStringProps {
  unit: string;
  selectedMint: any;
  isFocused?: boolean;
  onProgress?: (progress: number) => void;
  onLoading?: (loading: boolean) => void;
  onScanned?: (scanned: boolean) => void;
}

export const useProcessPaymentString = ({
  unit,
  selectedMint,
  isFocused = true,
  onProgress,
  onLoading,
  onScanned,
}: UseProcessPaymentStringProps) => {
  const [urDecoder, setUrDecoder] = useState<URDecoder>(new URDecoder());
  const [scanned, setScanned] = useState<boolean>(false);
  const appStateRef = useRef<string>(AppState.currentState);
  const { createMeltQuote } = useMelt();

  const processPaymentString = useCallback(
    async (scanning: ScanningData): Promise<void> => {
      // Don't process scans if app is backgrounded or screen is not focused
      if (appStateRef.current !== 'active' || !isFocused) {
        return;
      }

      if (!scanned || scanning.data.startsWith('ur:')) {
        onLoading?.(true);
        onScanned?.(true);
        setScanned(true);
        onProgress?.(0);

        // Handle UR codes
        if (scanning.data.startsWith('ur:')) {
          // Don't process if UR is already complete
          if (urDecoder.isComplete() && urDecoder.isSuccess()) {
            return;
          }

          const prevPer = urDecoder.getProgress();
          urDecoder.receivePart(scanning.data);
          const nextPer = urDecoder.getProgress();
          onProgress?.(nextPer);

          // Haptic feedback based on progress
          if (prevPer !== nextPer) {
            if (nextPer < 0.33) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } else if (nextPer < 0.66) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } else if (nextPer < 1) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          }

          // Check if UR is complete and successful
          if (urDecoder.isComplete() && urDecoder.isSuccess()) {
            const ur = urDecoder.resultUR();
            const decoded = ur.decodeCBOR();
            const _tokenString = new TextDecoder().decode(decoded);
            onProgress?.(0);

            // Create a receive history entry for ecash receive
            const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
              id: `receive-${Date.now()}`,
              type: 'receive',
              amount: getDecodedToken(_tokenString).proofs.reduce(
                (sum: number, proof: Proof) => sum + proof.amount,
                0
              ),
              unit: getDecodedToken(_tokenString).unit,
              mintUrl: getDecodedToken(_tokenString).mint,
              createdAt: Date.now(),
              metadata: {},
              token: _tokenString,
            };

            router.push({
              pathname: '/receiveToken',
              params: {
                receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
              },
            });

            // Reset the UR decoder after successful completion
            setUrDecoder(new URDecoder());
            return;
          }
        }

        // Handle regular ecash tokens
        if (isValidEcashToken(scanning.data)) {
          // Create a receive history entry for ecash receive
          const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
            id: `receive-${Date.now()}`,
            type: 'receive',
            amount: getDecodedToken(scanning.data).proofs.reduce(
              (sum: number, proof: Proof) => sum + proof.amount,
              0
            ),
            unit: getDecodedToken(scanning.data).unit,
            mintUrl: getDecodedToken(scanning.data).mint,
            createdAt: Date.now(),
            metadata: {},
            token: scanning.data,
          };

          router.push({
            pathname: '/receiveToken',
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
        } else if (
          (lnurlPayUtils.isLightningAddress(lnTrim(scanning.data)) ||
            lnurlPayUtils.isLnurlp(lnTrim(scanning.data)) ||
            isLightningInvoice(lnTrim(scanning.data))) &&
          selectedMint
        ) {
          const amount = getLightningAmount(lnTrim(scanning.data));
          if (!amount) {
            router.push({
              pathname: '/currency',
              params: {
                to: 'meltQuote',
                lnUrlOrAddress: lnTrim(scanning.data),
                unit,
              },
            });
            return;
          }

          const quote = await createMeltQuote(selectedMint, lnTrim(scanning.data));
          router.push({
            pathname: '/meltQuote',
            params: {
              meltQuote: JSON.stringify(quote),
            },
          });
        }
      }
    },
    [
      scanned,
      urDecoder,
      unit,
      selectedMint,
      createMeltQuote,
      isFocused,
      onProgress,
      onLoading,
      onScanned,
    ]
  );

  const reset = useCallback(() => {
    setScanned(false);
    setUrDecoder(new URDecoder());
    onProgress?.(0);
    onLoading?.(false);
  }, [onProgress, onLoading]);

  return {
    processPaymentString,
    reset,
    urDecoder,
    scanned,
  };
};
