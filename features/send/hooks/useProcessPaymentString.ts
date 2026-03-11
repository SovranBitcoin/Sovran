import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { router } from 'expo-router';

import { decodePaymentRequest } from '@cashu/cashu-ts';
import { URDecoder } from '@gandlaf21/bc-ur';

import { useMints, useBalanceContext } from 'coco-cashu-react';

import { parsePaymentInput, type ParsedPaymentInput } from '@/shared/lib/cashu/paymentInputParser';
import { resolvePaymentIntent, type WalletContext } from '@/shared/lib/cashu/paymentIntent';
import { buildReceiveHistoryEntry } from '@/shared/lib/cashu/utils';
import Haptics from '@/shared/ui/primitives/Haptics';
import { useScanHistoryStore, ScanSource } from '@/shared/stores/profile/scanHistoryStore';
import { paymentOptionsPopup } from '@/shared/lib/popup/popups/actionSheets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  /** Called when a payment-options sheet is dismissed without a selection, so the camera can re-enable scanning. */
  onUnlockCamera?: () => void;
}

// ---------------------------------------------------------------------------
// Payment-request routing (pure routing logic, extracted for clarity)
// ---------------------------------------------------------------------------

type RouteCashuPaymentRequestArgs = {
  paymentRequest: string;
  getValidMints: (allowedMints: string[] | undefined, minAmount: number | undefined) => any[];
  mintBalances: Record<string, number>;
};

function routeCashuPaymentRequest({
  paymentRequest,
  getValidMints,
  mintBalances,
}: RouteCashuPaymentRequestArgs) {
  const decoded = decodePaymentRequest(paymentRequest.trim());

  const hasMints = !!decoded.mints && decoded.mints.length > 0;
  const hasAmount = decoded.amount !== undefined && decoded.amount > 0;

  const allowedMints = hasMints ? decoded.mints : undefined;
  const minAmount = hasAmount ? decoded.amount : undefined;
  const validMints = getValidMints(allowedMints, minAmount);
  const singleValidMint = validMints.length === 1 ? validMints[0] : null;

  if (!hasMints && !hasAmount) {
    router.replace({
      pathname: '/(send-flow)/currency' as any,
      params: {
        to: 'paymentRequest',
        paymentRequest,
        unit: decoded.unit || 'sat',
      },
    });
    return;
  }

  if (!hasMints && hasAmount) {
    if (singleValidMint) {
      router.navigate({
        pathname: '/(send-flow)/sendToken' as any,
        params: {
          paymentRequest,
          amount: String(decoded.amount),
          selectedMintUrl: singleValidMint.mintUrl,
        },
      });
      return;
    }
    router.navigate({
      pathname: '/(send-flow)/mintSelect' as any,
      params: {
        to: 'paymentRequest',
        paymentRequest,
        minAmount: String(decoded.amount),
        unit: decoded.unit || 'sat',
      },
    });
    return;
  }

  if (hasMints && !hasAmount) {
    const bestValidMint =
      validMints.length > 0
        ? validMints.reduce((best, mint) => {
            const bestBalance = mintBalances[best.mintUrl] || 0;
            const mintBalance = mintBalances[mint.mintUrl] || 0;
            return mintBalance > bestBalance ? mint : best;
          })
        : null;

    router.replace({
      pathname: '/(send-flow)/currency' as any,
      params: {
        to: 'paymentRequest',
        paymentRequest,
        allowedMints: JSON.stringify(decoded.mints),
        unit: decoded.unit || 'sat',
        ...(bestValidMint && { selectedMintUrl: bestValidMint.mintUrl }),
      },
    });
    return;
  }

  if (singleValidMint) {
    router.navigate({
      pathname: '/(send-flow)/sendToken' as any,
      params: {
        paymentRequest,
        amount: String(decoded.amount),
        selectedMintUrl: singleValidMint.mintUrl,
      },
    });
    return;
  }

  router.navigate({
    pathname: '/(send-flow)/mintSelect' as any,
    params: {
      to: 'paymentRequest',
      paymentRequest,
      allowedMints: JSON.stringify(decoded.mints),
      minAmount: String(decoded.amount),
      unit: decoded.unit || 'sat',
    },
  });
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
  const [urDecoder, setUrDecoder] = useState<URDecoder>(new URDecoder());
  const [scanned, setScanned] = useState<boolean>(false);
  const processedRef = useRef(false);
  const appStateRef = useRef<string>(AppState.currentState);
  const addScan = useScanHistoryStore((state) => state.addScan);

  const { trustedMints } = useMints();
  const { balance: mintBalances } = useBalanceContext();

  const getValidMints = useCallback(
    (allowedMints: string[] | undefined, minAmount: number | undefined) => {
      return trustedMints.filter((mint) => {
        const balance = mintBalances[mint.mintUrl] || 0;
        if (allowedMints && allowedMints.length > 0 && !allowedMints.includes(mint.mintUrl))
          return false;
        if (minAmount !== undefined && minAmount > 0 && balance < minAmount) return false;
        if (balance === 0) return false;
        return true;
      });
    },
    [trustedMints, mintBalances]
  );

  /** Picks a mint for Lightning: prefer selectedMint if sufficient balance, else highest-balance mint. */
  const getMintForLightning = useCallback(
    (minAmount: number | undefined): string | undefined => {
      const candidates = trustedMints
        .filter((m) => {
          const balance = mintBalances[m.mintUrl] || 0;
          if (minAmount != null && minAmount > 0 && balance < minAmount) return false;
          return balance > 0;
        })
        .map((m) => ({ mintUrl: m.mintUrl, balance: mintBalances[m.mintUrl] || 0 }))
        .sort((a, b) => b.balance - a.balance);

      if (candidates.length === 0) return undefined;
      if (selectedMint && candidates.some((c) => c.mintUrl === selectedMint)) return selectedMint;
      return candidates[0].mintUrl;
    },
    [trustedMints, mintBalances, selectedMint]
  );

  const walletContext: WalletContext = useMemo(
    () => ({
      trustedMintUrls: trustedMints.map((m) => m.mintUrl),
      mintBalances,
    }),
    [trustedMints, mintBalances]
  );

  const finish = useCallback(
    (result: { urInProgress: boolean; progress?: number }) => {
      if (!result.urInProgress) {
        onLoading?.(false);
        onProgress?.(0);
      }
      return result;
    },
    [onLoading, onProgress]
  );

  // -----------------------------------------------------------------
  // Route a single resolved intent to the correct screen
  // Returns { lockedPending: true } when control is handed to a sheet.
  // -----------------------------------------------------------------
  const routeIntent = useCallback(
    (
      parsed: ParsedPaymentInput,
      intent: ReturnType<typeof resolvePaymentIntent>,
      source: ScanSource,
      rawData: string
    ): { lockedPending: true } | undefined => {
      switch (intent.type) {
        case 'receiveEcash': {
          addScan(rawData, intent.option.value, 'ecash', source);
          router.navigate({
            pathname: '/(receive-flow)/receiveToken' as any,
            params: {
              receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(intent.option.value)),
            },
          });
          break;
        }

        case 'sendCashuPaymentRequest': {
          addScan(rawData, intent.option.value, 'paymentRequest', source);
          routeCashuPaymentRequest({
            paymentRequest: intent.option.value,
            getValidMints,
            mintBalances,
          });
          break;
        }

        case 'payLightningInvoice': {
          const invoiceAmount = intent.option.amount ?? undefined;
          const mintForLightning = getMintForLightning(invoiceAmount);
          if (!mintForLightning) break;
          addScan(rawData, intent.option.value, 'lightning', source);

          if (intent.option.amount && intent.option.amount > 0) {
            router.navigate({
              pathname: '/(send-flow)/meltQuote' as any,
              params: { invoice: intent.option.value, selectedMintUrl: mintForLightning },
            });
          } else {
            router.navigate({
              pathname: '/(send-flow)/currency' as any,
              params: {
                to: 'meltQuote',
                lnUrlOrAddress: intent.option.value,
                unit,
                selectedMintUrl: mintForLightning,
              },
            });
          }
          break;
        }

        case 'payLightningAddress':
        case 'payLnurlp': {
          const mintForLightning = getMintForLightning(undefined);
          if (!mintForLightning) break;
          addScan(rawData, intent.option.value, 'lightning', source);
          router.navigate({
            pathname: '/(send-flow)/currency' as any,
            params: {
              to: 'meltQuote',
              lnUrlOrAddress: intent.option.value,
              unit,
              selectedMintUrl: mintForLightning,
            },
          });
          break;
        }

        case 'openMintUrl': {
          addScan(rawData, intent.url, 'mint', source);
          router.navigate({
            pathname: '/(mint-flow)/info' as any,
            params: { mintUrl: intent.url, fromScan: '1' },
          });
          break;
        }

        case 'openNpub': {
          addScan(rawData, intent.npub, 'npub', source);
          router.navigate({
            pathname: '/(user-flow)/profile' as any,
            params: { npub: intent.npub },
          });
          break;
        }

        case 'chooseOption': {
          paymentOptionsPopup({
            parsed,
            options: intent.options,
            unit,
            onSelectOption: (selected) => {
              const singleIntent = resolvePaymentIntent(
                { ...parsed, options: [selected] },
                walletContext
              );
              routeIntent(parsed, singleIntent, source, rawData);
            },
            onDismiss: () => {
              processedRef.current = false;
              setScanned(false);
              onLoading?.(false);
              onUnlockCamera?.();
            },
          });
          return { lockedPending: true };
        }

        case 'ignore':
          break;
      }
    },
    [
      addScan,
      getValidMints,
      getMintForLightning,
      mintBalances,
      unit,
      walletContext,
      onLoading,
      onUnlockCamera,
    ]
  );

  // -----------------------------------------------------------------
  // Main entry point
  // -----------------------------------------------------------------
  const processPaymentString = useCallback(
    async (
      scanning: ScanningData
    ): Promise<{ urInProgress: boolean; progress?: number; lockedPending?: boolean }> => {
      if (appStateRef.current !== 'active' || !isFocused) {
        return { urInProgress: false };
      }

      const source: ScanSource =
        scanning.type === 'paste' || scanning.type === 'deeplink' ? scanning.type : 'qr';

      if ((scanned || processedRef.current) && !scanning.data.startsWith('ur:')) {
        return { urInProgress: false };
      }

      processedRef.current = true;
      onLoading?.(true);
      onScanned?.(true);
      setScanned(true);
      onProgress?.(0);

      // -------------------------------------------------------------------
      // UR animated QR code fragments
      // -------------------------------------------------------------------
      if (scanning.data.startsWith('ur:')) {
        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          return finish({ urInProgress: false });
        }

        const prevPer = urDecoder.getProgress();
        urDecoder.receivePart(scanning.data);
        const nextPer = urDecoder.getProgress();
        onProgress?.(nextPer);

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

        if (urDecoder.isComplete() && urDecoder.isSuccess()) {
          const ur = urDecoder.resultUR();
          const decoded = ur.decodeCBOR();
          const tokenString = new TextDecoder().decode(decoded);

          addScan(scanning.data, tokenString, 'ecash', source);

          router.navigate({
            pathname: '/(receive-flow)/receiveToken' as any,
            params: {
              receiveHistoryEntry: JSON.stringify(buildReceiveHistoryEntry(tokenString)),
            },
          });

          setUrDecoder(new URDecoder());
          return finish({ urInProgress: false });
        }

        return { urInProgress: true, progress: nextPer };
      }

      // -------------------------------------------------------------------
      // Parse → resolve intent → route
      // -------------------------------------------------------------------
      const parsed = parsePaymentInput(scanning.data);
      const intent = resolvePaymentIntent(parsed, walletContext);

      const routeResult = routeIntent(parsed, intent, source, scanning.data);

      if (routeResult?.lockedPending) {
        return { urInProgress: false, lockedPending: true };
      }

      return finish({ urInProgress: false });
    },
    [
      scanned,
      urDecoder,
      isFocused,
      onProgress,
      onLoading,
      onScanned,
      addScan,
      walletContext,
      routeIntent,
      finish,
    ]
  );

  const reset = useCallback(() => {
    processedRef.current = false;
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
