/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * This module provides the core UI and logic for receiving ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';

import { router } from 'expo-router';

import { getDecodedToken } from '@cashu/cashu-ts';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { useReceive, useManager } from 'coco-cashu-react';

import {
  HistoryEntryHeader,
  useTransactionSource,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
} from '@/features/transactions';
import {
  unsupportedTokenUnitPopup,
  receiveFailedPopup,
  paymentStatusPopup,
} from '@/shared/lib/popup';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useMintManagement } from '@/features/mint';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';

import { useReceiveHistoryEntry } from '../hooks/useReceiveHistoryEntry';

interface ReceiveTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  receiveHistoryEntry: ReceiveHistoryEntry | string | undefined;
  onNavigateBack: () => void;
  onRedeemSuccess: () => void;
}

export function ReceiveTokenScreen({
  receiveHistoryEntry: receiveHistoryEntryProp,
  onNavigateBack,
  onRedeemSuccess,
}: ReceiveTokenScreenProps) {
  const { receive } = useReceive();
  const manager = useManager();
  const { isKnownMint } = useMintManagement();
  const [loading, setLoading] = useState(false);
  const [isAlreadySpent, setIsAlreadySpent] = useState(false);
  const paymentIdRef = useRef<string | null>(null);

  const {
    entry: receiveHistoryEntry,
    error: parseError,
    finalizedTransactionId,
  } = useReceiveHistoryEntry(receiveHistoryEntryProp);
  const sourceLabel = useTransactionSource(finalizedTransactionId ?? receiveHistoryEntry?.id);
  const mintInfo = useMintInfo(receiveHistoryEntry?.mintUrl);

  const tokenString = receiveHistoryEntry?.token
    ? manager.wallet.encodeToken(receiveHistoryEntry.token)
    : undefined;

  // Extract P2PK locking pubkey from token proofs (if any)
  const p2pkPubkey = useMemo(() => {
    const proofs = receiveHistoryEntry?.token?.proofs;
    if (!proofs?.length) return null;
    for (const proof of proofs) {
      try {
        const parsed = JSON.parse(proof.secret);
        if (Array.isArray(parsed) && parsed[0] === 'P2PK' && parsed[1]?.data) {
          return parsed[1].data as string;
        }
      } catch {
        // not a structured secret
      }
    }
    return null;
  }, [receiveHistoryEntry?.token?.proofs]);

  // Detect if this is a scan placeholder (created by useProcessPaymentString before redeem).
  // When we have a real entry (from history:updated or resolve), we're redeemed.
  const isScanPlaceholder = receiveHistoryEntry?.id?.startsWith('receive-') ?? false;
  const effectiveIsRedeemed = !isScanPlaceholder;
  const effectiveIsAlreadySpent = !effectiveIsRedeemed && isAlreadySpent;
  const isFinalizedReceive = effectiveIsRedeemed;

  // Determine local UI state for timeline.
  const receiveState = effectiveIsRedeemed
    ? 'redeemed'
    : effectiveIsAlreadySpent
      ? 'alreadySpent'
      : 'pending';

  // Clear payment status when leaving so retries start fresh. Uses a ref instead of
  // receiveHistoryEntry?.id to avoid the cleanup firing when useReceiveHistoryEntry resolves
  // the scan placeholder to the real entry (which changes the id and re-runs the effect).
  useEffect(() => {
    const ref = paymentIdRef;
    return () => {
      const pid = ref.current;
      if (!pid) return;
      const store = usePaymentStatusStore.getState();
      const active = store.active;
      if (
        active?.id === pid &&
        active?.variant === 'receive-ecash' &&
        active?.state === 'processing'
      ) {
        store.setActive(null);
      }
    };
  }, []);

  // Show error state if parsing failed
  if (parseError || !receiveHistoryEntry) {
    return (
      <ScreenErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onGoBack={onNavigateBack}
      />
    );
  }

  const handleRedeem = async () => {
    setLoading(true);
    setIsAlreadySpent(false);
    try {
      if (!tokenString) {
        throw new Error('Missing token data');
      }

      const decoded = getDecodedToken(tokenString);
      if (decoded.unit !== 'sat') {
        unsupportedTokenUnitPopup({ unit: decoded.unit ?? 'unknown' });
        setLoading(false);
        return;
      }

      const amount = receiveHistoryEntry.amount;
      const unit = receiveHistoryEntry.unit ?? 'sat';
      const mintUrl = receiveHistoryEntry.mintUrl;
      const id = receiveHistoryEntry.id;

      // Track the payment ID for cleanup — must be set before showing the toast
      paymentIdRef.current = id;

      // Clear any stale failed state so retry shows fresh pending (avoids "goes straight to error")
      const store = usePaymentStatusStore.getState();
      if (store.active?.id === id && store.active?.state === 'failed') {
        store.setActive(null);
      }

      // Show pending toast immediately on redeem button
      store.setActive({
        variant: 'receive-ecash',
        id,
        mintUrl,
        amount,
        unit,
        state: 'processing',
      });
      paymentStatusPopup({
        variant: 'receive-ecash',
        id,
        mintUrl,
        amount,
        unit,
      });

      await receive(tokenString);

      // If the token contained P2PK-locked proofs and the setting is enabled,
      // generate a fresh key so the used pubkey is retired.
      const regenerateP2PK = useSettingsStore.getState().regenerateP2PKOnReceive;
      if (regenerateP2PK) {
        try {
          const decoded = getDecodedToken(tokenString);
          const hadP2PK = decoded.proofs.some((proof) => {
            try {
              const parsed = JSON.parse(proof.secret);
              return Array.isArray(parsed) && parsed[0] === 'P2PK';
            } catch {
              return false;
            }
          });
          if (hadP2PK) {
            await manager.keyring.generateKeyPair();
          }
        } catch (e) {
          // Non-critical — don't block the receive flow
          console.warn('Failed to regenerate P2PK key:', e);
        }
      }

      // Find the real history entry created by coco and store location against it
      const history = await manager.history.getPaginatedHistory(0, 5);
      const realEntry = history.find(
        (h) =>
          h.type === 'receive' &&
          h.amount === receiveHistoryEntry.amount &&
          h.mintUrl === receiveHistoryEntry.mintUrl
      );

      // Capture and store location at redeem time (respects settings)
      if (realEntry?.id) {
        await captureAndStoreLocation(realEntry.id);

        // Link the scan history entry to the transaction.
        // Prefer the original raw token string (stored in metadata) because
        // re-encoding via encodeToken() can produce a different string than
        // what was stored as `processed` in the scan history.
        const rawToken = (receiveHistoryEntry.metadata as any)?.rawToken;
        if (rawToken || tokenString) {
          useScanHistoryStore.getState().linkTransaction(rawToken || tokenString, realEntry.id);
        }
      }

      // useReceiveHistoryEntry will update entry/finalizedTransactionId when history:updated fires.
      // usePaymentStatusListener's receive:created handler confirms the toast automatically.

      // Defer navigation so the timeline and toast can render the final state before dismissal.
      setTimeout(() => onRedeemSuccess?.(), 0);
    } catch (error) {
      console.error(error);
      const store = usePaymentStatusStore.getState();
      const hadPaymentToast =
        store.active?.id === receiveHistoryEntry.id && store.active?.state === 'processing';
      if (hadPaymentToast) {
        store.setFailed(receiveHistoryEntry.id, error);
        // Payment status toast shows failed state — do not show unrelated popup
      } else {
        receiveFailedPopup({ text: error instanceof Error ? error.message : undefined });
      }
      const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
      const tokenAlreadySpent =
        errorMessage.includes('token already spent') ||
        errorMessage.includes('proof already spent') ||
        errorMessage.includes('already spent');
      if (tokenAlreadySpent) {
        setIsAlreadySpent(true);
      }
    }
    setLoading(false);
  };

  const handleRedeemPress = async () => {
    const isMintTrusted = await isKnownMint(receiveHistoryEntry.mintUrl);
    if (isMintTrusted) {
      await handleRedeem();
    } else {
      router.navigate({
        pathname: '/(mint-flow)/info',
        params: {
          mintUrl: receiveHistoryEntry.mintUrl,
          fromAccepter: '1',
          ...(tokenString ? { token: tokenString } : {}),
        },
      });
    }
  };

  const bottomButtons = (
    <BottomButtons>
      <ButtonHandler
        buttons={[
          {
            text: 'Close',
            icon: 'ri:close-circle-line',
            variant: 'secondary',
            onPress: async () => onNavigateBack(),
            condition: effectiveIsRedeemed || effectiveIsAlreadySpent,
          },
          {
            text: 'Cancel',
            variant: 'secondary',
            onPress: async () => onNavigateBack(),
            condition: !effectiveIsRedeemed && !effectiveIsAlreadySpent,
          },
          {
            text: 'Redeem Ecash',
            variant: 'primary',
            onPress: handleRedeemPress,
            loading: loading,
            condition: !!tokenString && !effectiveIsRedeemed && !effectiveIsAlreadySpent,
          },
        ]}
      />
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={receiveHistoryEntry} />

        {isFinalizedReceive && (
          <TransactionLocationSection
            transactionId={finalizedTransactionId ?? receiveHistoryEntry.id}
          />
        )}

        {mintInfo && <HistoryEntryRefresh historyEntry={receiveHistoryEntry} mintInfo={mintInfo} />}

        <HistoryEntryTimeline
          historyEntry={{ ...receiveHistoryEntry, state: receiveState } as ReceiveHistoryEntry}
        />

        {/* Technical details - collapsed by default */}
        <DetailsSection
          items={[
            ...(sourceLabel ? [{ title: 'Source', value: sourceLabel }] : []),
            ...(p2pkPubkey ? [{ title: 'P2PK', value: truncateMiddle(p2pkPubkey, 8) }] : []),
            ...(tokenString ? [{ title: 'Token', value: truncateMiddle(tokenString, 6) }] : []),
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
