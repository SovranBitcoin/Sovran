/**
 * Declarative NFC ecash payment: status-driven flow with typed errors.
 *
 * - status: 'idle' | 'paying' | 'error' — single source of truth for UI
 * - error: resolved user message (title + message) when status === 'error'
 * - startPayment(usdLimit?) kicks off the flow; rollback and overlay logic handled inside
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { router } from 'expo-router';

// TODO: re-export getEncodedTokenV4 from coco-cashu-core
import { getEncodedTokenV4 } from '@cashu/cashu-ts';

import type { SendHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import { NfcPayment, NfcError } from '@/helper/nfc';
import { getNfcErrorMessage } from '@/helper/nfc/messages';
import type { NfcErrorMessage } from '@/helper/nfc/messages';
import { useSendWithHistory } from '@/hooks/coco/useSendWithHistory';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';
import { nfcPaymentSentPopup, walletNotReadyPopup, nfcErrorPopup, fmt } from '@/helper/popup';
import { PAYMENT_TIERS } from '@/constants/wallet-header';
import { useScanHistoryStore } from 'stores/scanHistoryStore';

export type NfcPaymentStatus = 'idle' | 'paying' | 'error';

interface UseNfcEcashPaymentArgs {
  send: ReturnType<typeof useSendWithHistory>['send'];
  manager: ReturnType<typeof useManager>;
  availableMints: Record<string, number>;
  preferredMint: string | undefined;
  getSelectedMint: (pubkey: string) => string | undefined;
  pubkey: string | undefined;
  usdToSats: (usd: number) => number | undefined;
}

export function useNfcEcashPayment({
  send,
  manager,
  availableMints,
  preferredMint,
  getSelectedMint,
  pubkey,
  usdToSats,
}: UseNfcEcashPaymentArgs) {
  const addScan = useScanHistoryStore((state) => state.addScan);
  const linkTransaction = useScanHistoryStore((state) => state.linkTransaction);

  const [status, setStatus] = useState<NfcPaymentStatus>('idle');
  const [error, setError] = useState<NfcErrorMessage | null>(null);

  const lastNfcSendEntryRef = useRef<SendHistoryEntry | null>(null);
  const [pendingNfcFinalizationOperationId, setPendingNfcFinalizationOperationId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!manager || !pendingNfcFinalizationOperationId) return;
    const unsubscribe = manager.on('history:updated', ({ entry }) => {
      if (
        entry.type === 'send' &&
        entry.operationId === pendingNfcFinalizationOperationId &&
        entry.state === 'finalized'
      ) {
        const sendEntry = entry as SendHistoryEntry;
        nfcPaymentSentPopup({
          text: fmt`${{ amount: sendEntry.amount, unit: 'sat' }} sent`,
          icon: 'custom:nfc-success',
          duration: 2600,
          onClose: () => {
            router.navigate({
              pathname: '/(send-flow)/sendToken' as any,
              params: { sendHistoryEntry: JSON.stringify(sendEntry) },
            });
          },
        });
        setPendingNfcFinalizationOperationId(null);
      }
    });
    return () => unsubscribe();
  }, [manager, pendingNfcFinalizationOperationId]);

  const startPayment = useCallback(
    async (usdLimit?: number) => {
      const maxAmountSats = usdLimit !== undefined ? usdToSats(usdLimit) : undefined;

      if (!send || !manager) {
        setError({ title: 'Error', message: 'Wallet not ready. Please try again.' });
        setStatus('error');
        walletNotReadyPopup();
        return;
      }

      const mintToUse = (pubkey ? getSelectedMint(pubkey) : undefined) || preferredMint;
      let lastOperationId: string | null = null;
      let lastScannedRaw: string | null = null;

      const rollbackPendingSend = async () => {
        if (!lastOperationId) return;
        try {
          const operation = await manager.send.getOperation(lastOperationId);
          if (operation && ['prepared', 'executing', 'pending'].includes(operation.state)) {
            await manager.send.rollback(lastOperationId);
          }
        } catch (e) {
          console.warn('[NFC] Rollback failed:', e);
        }
      };

      setError(null);
      setStatus('paying');

      try {
        const result = await NfcPayment.performPayment({
          createToken: async (mintUrl, amount) => {
            const { token, historyEntry } = await send(mintUrl, amount);
            lastOperationId = historyEntry.operationId;
            lastNfcSendEntryRef.current = historyEntry;
            if (historyEntry.id) await captureAndStoreLocation(historyEntry.id);
            if (lastScannedRaw && historyEntry.id) {
              linkTransaction(lastScannedRaw, historyEntry.id);
              lastScannedRaw = null;
            }
            return getEncodedTokenV4(token);
          },
          recoverToken: rollbackPendingSend,
          availableMints,
          preferredMint: mintToUse,
          maxAmountSats,
          onScanRead: (raw) => {
            addScan(raw, raw, 'ecash', 'nfc');
            lastScannedRaw = raw;
          },
          onLightningInvoice: (invoice, amount) => {
            addScan(invoice, invoice, 'lightning', 'nfc');
            if (amount) {
              router.navigate({
                pathname: '/(send-flow)/mintSelect' as any,
                params: { to: 'meltQuote', unit: 'sat', minAmount: String(amount), invoice },
              });
            } else {
              router.navigate({
                pathname: '/(send-flow)/currency' as any,
                params: { to: 'meltQuote', lnUrlOrAddress: invoice, unit: 'sat' },
              });
            }
          },
        });

        setStatus('idle');
        if (result.mintUrl && lastNfcSendEntryRef.current) {
          setPendingNfcFinalizationOperationId(lastNfcSendEntryRef.current.operationId);
          lastNfcSendEntryRef.current = null;
        }
      } catch (err) {
        const isNfcError = err instanceof NfcError;
        const code = isNfcError ? err.code : 'PAYMENT_FAILED';
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (code === 'TAG_LOST' || code === 'TRANSCEIVE_FAILED' || !isNfcError) {
          await rollbackPendingSend();
        }

        const resolved = getNfcErrorMessage(code, errorMessage, { maxAmountSats });
        setError(resolved);
        setStatus('error');
        nfcErrorPopup({ title: resolved.title, message: resolved.message });
      }
    },
    [
      send,
      manager,
      availableMints,
      preferredMint,
      usdToSats,
      getSelectedMint,
      pubkey,
      addScan,
      linkTransaction,
    ]
  );

  const resetError = useCallback(() => {
    setError(null);
    if (status === 'error') setStatus('idle');
  }, [status]);

  const handleNfcPaymentAlert = useCallback(() => {
    Alert.alert('NFC Payment Limit', 'Select your payment limit', [
      ...PAYMENT_TIERS.map((tier) => ({
        text: tier.label,
        onPress: () => startPayment(tier.usdLimit),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [startPayment]);

  return useMemo(
    () => ({
      status,
      error,
      resetError,
      startPayment,
      handleNfcPaymentAlert,
      isIdle: status === 'idle',
      isPaying: status === 'paying',
      isError: status === 'error',
    }),
    [status, error, resetError, startPayment, handleNfcPaymentAlert]
  );
}
