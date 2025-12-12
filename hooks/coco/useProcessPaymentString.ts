import {
  getLightningAmount,
  isLightningInvoice,
  isValidEcashToken,
  lnTrim,
  isLightningAddress,
  isLnurlp,
} from '@/helper/coco/utils';
import { Proof } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';
import { getDecodedToken, ReceiveHistoryEntry } from 'coco-cashu-core';
import Haptics from 'components/ui/Haptics';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { nip19 } from 'nostr-tools';
import { useScanHistoryStore } from 'stores/scanHistoryStore';

/**
 * Check if a string is a valid npub and extract the pubkey
 * Handles both 'npub1...' and 'nostr:npub1...' formats
 * @returns The npub string if valid, null otherwise
 */
const parseNpub = (data: string): string | null => {
  const trimmed = data.trim();

  // Remove 'nostr:' prefix if present
  const npubString = trimmed.startsWith('nostr:') ? trimmed.slice(6) : trimmed;

  // Check if it looks like an npub
  if (!npubString.startsWith('npub1')) {
    return null;
  }

  // Validate by attempting to decode
  try {
    const decoded = nip19.decode(npubString);
    if (decoded.type === 'npub') {
      return npubString;
    }
  } catch {
    // Invalid npub format
    return null;
  }

  return null;
};

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
  const addScan = useScanHistoryStore((state) => state.addScan);

  const processPaymentString = useCallback(
    async (scanning: ScanningData): Promise<{ urInProgress: boolean; progress?: number }> => {
      // Don't process scans if app is backgrounded or screen is not focused
      if (appStateRef.current !== 'active' || !isFocused) {
        return { urInProgress: false };
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
            return { urInProgress: false };
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

            // Only save to scan history once when UR is fully decoded (not for each frame)
            addScan(scanning.data, _tokenString, 'ecash');

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

            router.navigate({
              pathname: '/(receive-flow)/receiveToken' as any,
              params: {
                receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
              },
            });

            // Reset the UR decoder after successful completion
            setUrDecoder(new URDecoder());
            return { urInProgress: false };
          }

          // UR is in progress but not complete - keep loading state
          return { urInProgress: true, progress: nextPer };
        }

        // Handle regular ecash tokens
        if (isValidEcashToken(scanning.data)) {
          // Save to scan history
          addScan(scanning.data, scanning.data, 'ecash');

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

          router.navigate({
            pathname: '/(receive-flow)/receiveToken' as any,
            params: {
              receiveHistoryEntry: JSON.stringify(receiveHistoryEntry),
            },
          });
          return { urInProgress: false };
        } else if (
          (isLightningAddress(lnTrim(scanning.data)) ||
            isLnurlp(lnTrim(scanning.data)) ||
            isLightningInvoice(lnTrim(scanning.data))) &&
          selectedMint
        ) {
          const trimmedData = lnTrim(scanning.data);
          const amount = getLightningAmount(trimmedData);
          const isInvoice = isLightningInvoice(trimmedData);

          // Save to scan history
          addScan(scanning.data, trimmedData, 'lightning');

          if (isInvoice && amount) {
            // Direct Lightning invoice with amount - navigate to MeltQuoteScreen
            // The screen will create the quote internally
            router.navigate({
              pathname: '/(send-flow)/meltQuote' as any,
              params: {
                invoice: trimmedData,
              },
            });
            return { urInProgress: false };
          }

          // Lightning address/LNURL without amount - go to currency screen to get amount
          router.navigate({
            pathname: '/(send-flow)/currency' as any,
            params: {
              to: 'meltQuote',
              lnUrlOrAddress: trimmedData,
              unit,
            },
          });
          return { urInProgress: false };
        }

        // Handle HTTP/HTTPS URLs - navigate to mint info screen
        const trimmedUrl = scanning.data.trim();
        if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
          // Save to scan history
          addScan(scanning.data, trimmedUrl, 'mint');

          router.navigate({
            pathname: '/(mint-flow)/info' as any,
            params: {
              mintUrl: trimmedUrl,
              fromScan: '1',
            },
          });
          return { urInProgress: false };
        }

        // Handle npub/nostr:npub - navigate to user profile screen
        const validNpub = parseNpub(scanning.data);
        if (validNpub) {
          // Store the scan in history
          addScan(scanning.data, validNpub, 'npub');

          router.navigate({
            pathname: '/(user-flow)/profile' as any,
            params: {
              npub: validNpub,
            },
          });
          return { urInProgress: false };
        }
      }

      return { urInProgress: false };
    },
    [scanned, urDecoder, unit, selectedMint, isFocused, onProgress, onLoading, onScanned, addScan]
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
