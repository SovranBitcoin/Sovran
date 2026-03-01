import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { router } from 'expo-router';

// TODO: re-export decodePaymentRequest & PaymentRequestTransportType from coco-cashu-core
import { decodePaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';
import { nip19 } from 'nostr-tools';

import { useMints, useBalanceContext } from 'coco-cashu-react';

import {
  buildReceiveHistoryEntry,
  getLightningAmount,
  isLightningInvoice,
  isValidEcashToken,
  lnTrim,
  isLightningAddress,
  isLnurlp,
} from '@/helper/coco/utils';
import Haptics from 'components/ui/Haptics';
import { useScanHistoryStore, ScanSource } from 'stores/scanHistoryStore';

/**
 * Check if a string is a valid NUT-18 payment request (creqA prefix)
 * @returns true if valid payment request with nostr transport
 */
const isNostrPaymentRequest = (data: string): boolean => {
  const trimmed = data.trim();
  if (!trimmed.startsWith('creqA')) {
    return false;
  }

  try {
    const decoded = decodePaymentRequest(trimmed);
    // Check if it has a nostr transport
    const nostrTransport = decoded.transport?.find(
      (t) => t.type === PaymentRequestTransportType.NOSTR
    );
    return !!nostrTransport;
  } catch {
    return false;
  }
};

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
  /**
   * Optional source hint for scans.
   * Common values: 'paste', 'deeplink', 'qr'.
   */
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

  // Get all trusted mints and their balances for payment request routing
  const { trustedMints } = useMints();
  const { balance: mintBalances } = useBalanceContext();

  // Helper to calculate valid mints for a payment request
  const getValidMints = useCallback(
    (allowedMints: string[] | undefined, minAmount: number | undefined) => {
      return trustedMints.filter((mint) => {
        const balance = mintBalances[mint.mintUrl] || 0;
        // If allowedMints specified, mint must be in the list
        if (allowedMints && allowedMints.length > 0 && !allowedMints.includes(mint.mintUrl)) {
          return false;
        }
        // If minAmount specified, mint must have sufficient balance
        if (minAmount !== undefined && minAmount > 0 && balance < minAmount) {
          return false;
        }
        // Must have some balance for sending
        if (balance === 0) {
          return false;
        }
        return true;
      });
    },
    [trustedMints, mintBalances]
  );

  const processPaymentString = useCallback(
    async (scanning: ScanningData): Promise<{ urInProgress: boolean; progress?: number }> => {
      // Don't process scans if app is backgrounded or screen is not focused
      if (appStateRef.current !== 'active' || !isFocused) {
        return { urInProgress: false };
      }

      // Resolve source: accept known values, otherwise default to 'qr'
      const source: ScanSource =
        scanning.type === 'paste' || scanning.type === 'deeplink' ? scanning.type : 'qr';

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
            const tokenString = new TextDecoder().decode(decoded);
            onProgress?.(0);

            addScan(scanning.data, tokenString, 'ecash', source);

            router.navigate({
              pathname: '/(receive-flow)/receiveToken' as any,
              params: {
                receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(tokenString)),
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
          addScan(scanning.data, scanning.data, 'ecash', source);

          router.navigate({
            pathname: '/(receive-flow)/receiveToken' as any,
            params: {
              receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(scanning.data)),
            },
          });
          return { urInProgress: false };
        }

        // Handle NUT-18 payment requests with Nostr transport
        if (isNostrPaymentRequest(scanning.data)) {
          // Save to scan history
          addScan(scanning.data, scanning.data, 'paymentRequest', source);

          // Decode to check for missing mint/amount
          const decoded = decodePaymentRequest(scanning.data.trim());
          const hasMints = decoded.mints && decoded.mints.length > 0;
          const hasAmount = decoded.amount !== undefined && decoded.amount > 0;

          // Calculate valid mints upfront to minimize user steps
          const allowedMints = hasMints ? decoded.mints : undefined;
          const minAmount = hasAmount ? decoded.amount : undefined;
          const validMints = getValidMints(allowedMints, minAmount);
          const singleValidMint = validMints.length === 1 ? validMints[0] : null;

          // Route based on what data is available and how many valid mints exist:
          // | Mints | Amount | Valid | Flow |
          // |-------|--------|-------|------|
          // | No    | No     | Any   | currency.tsx (pick mint + amount) -> PaymentRequestScreen |
          // | No    | Yes    | 1     | PaymentRequestScreen directly |
          // | No    | Yes    | 2+    | mintSelect.tsx -> PaymentRequestScreen |
          // | Yes   | No     | 1     | currency.tsx (amount only) -> SendTokenScreen (normal) |
          // | Yes   | No     | 2+    | currency.tsx (pick from allowed + amount) -> SendTokenScreen (normal) |
          // | Yes   | Yes    | 1     | SendTokenScreen (PR mode) directly |
          // | Yes   | Yes    | 2+    | mintSelect.tsx -> SendTokenScreen (PR mode) |

          if (!hasMints && !hasAmount) {
            // No mints + No amount: Go to currency screen (user picks mint + enters amount)
            // CurrencyScreen handles Nostr sending and navigates to SendTokenScreen
            // Use replace so it works when pasting from an existing CurrencyScreen
            router.replace({
              pathname: '/(send-flow)/currency' as any,
              params: {
                to: 'paymentRequest',
                paymentRequest: scanning.data,
                unit: decoded.unit || 'sat',
              },
            });
          } else if (!hasMints && hasAmount) {
            // Amount only
            if (singleValidMint) {
              // Only 1 valid mint - go directly to SendTokenScreen in payment request mode
              router.navigate({
                pathname: '/(send-flow)/sendToken' as any,
                params: {
                  paymentRequest: scanning.data,
                  amount: String(decoded.amount),
                  selectedMintUrl: singleValidMint.mintUrl,
                },
              });
            } else {
              // Multiple valid mints - show mintSelect, then to SendTokenScreen
              router.navigate({
                pathname: '/(send-flow)/mintSelect' as any,
                params: {
                  to: 'paymentRequest',
                  paymentRequest: scanning.data,
                  minAmount: String(decoded.amount),
                  unit: decoded.unit || 'sat',
                },
              });
            }
          } else if (hasMints && !hasAmount) {
            // Mints specified but no amount - go to currency (user enters amount)
            // CurrencyScreen handles Nostr sending and navigates to SendTokenScreen

            // Find the best valid mint (highest balance) to use as default
            const bestValidMint =
              validMints.length > 0
                ? validMints.reduce((best, mint) => {
                    const bestBalance = mintBalances[best.mintUrl] || 0;
                    const mintBalance = mintBalances[mint.mintUrl] || 0;
                    return mintBalance > bestBalance ? mint : best;
                  })
                : null;

            // Use replace so it works when pasting from an existing CurrencyScreen
            router.replace({
              pathname: '/(send-flow)/currency' as any,
              params: {
                to: 'paymentRequest',
                paymentRequest: scanning.data,
                allowedMints: JSON.stringify(decoded.mints),
                unit: decoded.unit || 'sat',
                // Always pass the best valid mint as default (if any exist)
                ...(bestValidMint && { selectedMintUrl: bestValidMint.mintUrl }),
              },
            });
          } else {
            // Both mints and amount specified
            if (singleValidMint) {
              // Only 1 valid mint - go directly to SendTokenScreen in payment request mode
              router.navigate({
                pathname: '/(send-flow)/sendToken' as any,
                params: {
                  paymentRequest: scanning.data,
                  amount: String(decoded.amount),
                  selectedMintUrl: singleValidMint.mintUrl,
                },
              });
            } else {
              // Multiple valid mints - show mintSelect, then to SendTokenScreen
              router.navigate({
                pathname: '/(send-flow)/mintSelect' as any,
                params: {
                  to: 'paymentRequest',
                  paymentRequest: scanning.data,
                  allowedMints: JSON.stringify(decoded.mints),
                  minAmount: String(decoded.amount),
                  unit: decoded.unit || 'sat',
                },
              });
            }
          }
          return { urInProgress: false };
        }

        if (
          (isLightningAddress(lnTrim(scanning.data)) ||
            isLnurlp(lnTrim(scanning.data)) ||
            isLightningInvoice(lnTrim(scanning.data))) &&
          selectedMint
        ) {
          const trimmedData = lnTrim(scanning.data);
          const amount = getLightningAmount(trimmedData);
          const isInvoice = isLightningInvoice(trimmedData);

          // Save to scan history
          addScan(scanning.data, trimmedData, 'lightning', source);

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
          addScan(scanning.data, trimmedUrl, 'mint', source);

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
          addScan(scanning.data, validNpub, 'npub', source);

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
    [
      scanned,
      urDecoder,
      unit,
      selectedMint,
      isFocused,
      onProgress,
      onLoading,
      onScanned,
      addScan,
      getValidMints,
      mintBalances,
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
