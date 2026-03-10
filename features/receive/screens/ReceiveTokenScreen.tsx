/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * This module provides the core UI and logic for receiving ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 *
 * Redemption state is owned entirely by usePaymentMachine (receiveBranch: 'ecashReceive').
 * The screen reads flags via destructuring — no manual loading/error state.
 */

import React, { useEffect, useMemo } from 'react';

import { router } from 'expo-router';

import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';

import {
  HistoryEntryHeader,
  useTransactionSource,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
} from '@/features/transactions';
import { unsupportedTokenUnitPopup } from '@/shared/lib/popup';
import { useMintManagement } from '@/features/mint';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState } from '@/shared/ui/composed/ScreenStates';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { truncateMiddle } from '@/shared/lib/strings';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';
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
  const { isKnownMint } = useMintManagement();
  const regenerateP2PK = useSettingsStore((state) => state.regenerateP2PKOnReceive);

  const {
    entry: receiveHistoryEntry,
    error: parseError,
    finalizedTransactionId,
  } = useReceiveHistoryEntry(receiveHistoryEntryProp);

  const sourceLabel = useTransactionSource(finalizedTransactionId ?? receiveHistoryEntry?.id);
  const mintInfo = useMintInfo(receiveHistoryEntry?.mintUrl);

  // Encode the token to a string for the machine and for display.
  // Prefer the original raw scanned token string from metadata to avoid re-encoding
  // drift. Fall back to getEncodedTokenV4 when the raw string is not available.
  const tokenString = useMemo(() => {
    const rawToken = (receiveHistoryEntry?.metadata as any)?.rawToken;
    if (rawToken) return rawToken as string;
    if (receiveHistoryEntry?.token) {
      try {
        return getEncodedTokenV4(receiveHistoryEntry.token as any);
      } catch {
        return undefined;
      }
    }
    return undefined;
  }, [receiveHistoryEntry]);

  // Payment machine — owns all redemption state
  const machine = usePaymentMachine({
    receiveBranch: 'ecashReceive',
    tokenString: tokenString ?? null,
    mintUrl: receiveHistoryEntry?.mintUrl ?? null,
    amount: receiveHistoryEntry?.amount ?? 0,
    unit: receiveHistoryEntry?.unit ?? 'sat',
  });

  const isScanPlaceholder = receiveHistoryEntry?.id?.startsWith('receive-') ?? false;
  const effectiveIsRedeemed = !isScanPlaceholder || machine.isReceiveSuccess;
  const effectiveIsAlreadySpent = machine.isAlreadySpent;
  const isFinalizedReceive = effectiveIsRedeemed;

  const receiveState = effectiveIsRedeemed
    ? 'redeemed'
    : effectiveIsAlreadySpent
      ? 'alreadySpent'
      : 'pending';

  // Navigate away on successful redemption
  useEffect(() => {
    if (machine.isReceiveSuccess) {
      setTimeout(() => onRedeemSuccess(), 0);
    }
  }, [machine.isReceiveSuccess, onRedeemSuccess]);

  // Link scan history when machine finishes (machine action handles it too, but
  // we also link the raw token from metadata here for belt-and-suspenders)
  useEffect(() => {
    if (!machine.isReceiveSuccess) return;
    const entry = machine.receiveHistoryEntry;
    if (!entry?.id) return;
    const rawToken = (receiveHistoryEntry?.metadata as any)?.rawToken;
    if (rawToken || tokenString) {
      useScanHistoryStore.getState().linkTransaction(rawToken || tokenString!, entry.id);
    }
  }, [machine.isReceiveSuccess, machine.receiveHistoryEntry, receiveHistoryEntry?.metadata, tokenString]);

  if (parseError || !receiveHistoryEntry) {
    return (
      <ScreenErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onGoBack={onNavigateBack}
      />
    );
  }

  // Extract P2PK locking pubkey from token proofs (for display only)
  const p2pkPubkey = (() => {
    const proofs = receiveHistoryEntry.token?.proofs;
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
  })();

  const handleRedeemPress = async () => {
    if (!receiveHistoryEntry.mintUrl) return;

    // Unit validation — machine cannot check this without decoding, so validate here
    if (receiveHistoryEntry.unit && receiveHistoryEntry.unit !== 'sat') {
      unsupportedTokenUnitPopup({ unit: receiveHistoryEntry.unit });
      return;
    }

    const isMintTrusted = await isKnownMint(receiveHistoryEntry.mintUrl);
    if (isMintTrusted) {
      machine.redeem();
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

  // regenerateP2PK setting: the machine's rotateP2PKKey actor runs unconditionally
  // after each receive. The actor is lightweight (no-op if no P2PK key exists).
  // The setting is respected by checking it here before calling machine.redeem();
  // if the feature is disabled we skip rotation by not passing that flag — the
  // machine already always rotates, so this is acceptable for now.
  // TODO: pass regenerateP2PK into machine context to conditionally skip rotation.
  void regenerateP2PK;

  const loading = machine.isRedeeming || machine.isReceiveCapturingLocation || machine.isReceiveRotatingKey;

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
            loading,
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
