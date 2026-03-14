/**
 * @fileoverview Send Token screen component
 *
 * Pure display component for ecash send transactions.
 * The token is created before navigation — this screen only renders
 * and subscribes to live updates on the provided SendHistoryEntry.
 */

import React, { useState } from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import * as SQLite from 'expo-sqlite';

import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useManager } from 'coco-cashu-react';

import {
  nfcEcashSharedPopup,
  nfcConnectionLostPopup,
  nfcSendFailedPopup,
  copyPopup,
  tokenCannotCancelPopup,
  transactionCancelledPopup,
  tokenCannotCheckStatusPopup,
  tokenRedeemedPopup,
  tokenStillPendingPopup,
  tokenMixedStatesPopup,
  tokenCheckFailedPopup,
  tokenRedeemedByRecipientPopup,
  transactionAlreadyCancelledPopup,
  tokenPendingNotRedeemedPopup,
  cancelTransactionFailedPopup,
  operationNotFoundPopup,
  operationInvalidStatePopup,
} from '@/shared/lib/popup';

import {
  HistoryEntryHeader,
  useTransactionSource,
  useHistoryEntry,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
} from '@/features/transactions';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { writeTokenToNFC } from '@/shared/lib/nfc';
import { truncateMiddle } from '@/shared/lib/strings';
import { convertTime } from '@/shared/lib/time';
import { useMintInfo } from '@/shared/hooks/useMintInfo';
import { useProfileStore } from '@/shared/stores/global/profileStore';

/**
 * Update state for a legacy send history entry (no operationId).
 *
 * Legacy entries (pre-Dec 2025) have operationId = NULL in the DB. Coco's
 * update methods all key on (mintUrl, operationId), and NULL = NULL is false
 * in SQL, so they can never match these rows.
 */
async function updateLegacyHistoryState(
  entry: SendHistoryEntry,
  state: string,
  mintUrl: string,
  manager: ReturnType<typeof useManager>,
  accountIndex: number
) {
  if (!entry.id) return;
  try {
    const dbName = accountIndex === 0 ? 'coco.db' : `coco-${accountIndex}.db`;
    const db = await SQLite.openDatabaseAsync(dbName);
    await db.runAsync(
      `UPDATE coco_cashu_history SET state = ? WHERE id = ? AND type = 'send'`,
      state,
      Number(entry.id)
    );
    await manager.historyService.handleHistoryUpdated(mintUrl, { ...entry, state } as any);
  } catch (err) {
    console.warn('[SendTokenScreen] Failed to update legacy history state:', err);
  }
}

interface SendTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  sendHistoryEntry?: SendHistoryEntry | string;
  onNavigateBack: () => void;
}

export function SendTokenScreen({
  sendHistoryEntry: sendHistoryEntryProp,
  onNavigateBack,
}: SendTokenScreenProps) {
  const manager = useManager();
  const accountIndex = useProfileStore((s) => s.activeAccountIndex);

  const { entry: currentTransaction, error: parseError } =
    useHistoryEntry<SendHistoryEntry>(sendHistoryEntryProp);
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const mintInfo = useMintInfo(currentTransaction?.mintUrl);

  const [isCheckingStatus, setIsCheckingStatus] = useState(false);

  if (parseError) {
    return <ScreenErrorState message={parseError} onGoBack={onNavigateBack} />;
  }

  if (!currentTransaction) {
    return <ScreenLoadingState message="Loading transaction..." />;
  }

  const token = currentTransaction.token;
  const formattedToken = token ? getEncodedTokenV4(token) : '';
  const isLongToken = formattedToken.length >= 500;
  const isPaid =
    currentTransaction.state === 'finalized' || currentTransaction.state === 'rolledBack';

  // --- Token handlers ---

  const handleNFCSend = async (close: (event: any) => void): Promise<void> => {
    if (!token) return;
    const writeResult = await writeTokenToNFC(getEncodedTokenV4(token));
    if (writeResult.success) {
      nfcEcashSharedPopup({ onClose: () => close({}) });
      return;
    }

    const operationId = currentTransaction.operationId;
    const lostConnection =
      writeResult.errorCode === 'TAG_LOST' || writeResult.errorCode === 'TRANSCEIVE_FAILED';

    if (lostConnection && operationId) {
      try {
        await manager.send.rollback(operationId);
        nfcConnectionLostPopup();
        return;
      } catch (rollbackError) {
        nfcSendFailedPopup({
          rollbackFailed: true,
          text: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
        return;
      }
    }

    nfcSendFailedPopup({
      text: writeResult.errorMessage || 'Unable to write token via NFC.',
    });
  };

  const handleCopy = async (onClose: (event: any) => void) => {
    if (!token) return;
    await Clipboard.setStringAsync(getEncodedTokenV4(token));
    copyPopup('ecashToken', { onClose: () => onClose({}) });
  };

  const handleShare = async (onClose: (event: any) => void) => {
    if (!token) return;
    await Share.share({ message: 'cashu://' + getEncodedTokenV4(token) });
    onClose({});
  };

  const handleCancelSend = async (onClose: (event: any) => void) => {
    if (!currentTransaction.operationId) {
      tokenCannotCancelPopup({ onClose: () => onClose({}) });
      return;
    }

    try {
      await manager.send.rollback(currentTransaction.operationId);
      transactionCancelledPopup({ onClose: () => onClose({}) });
    } catch (error) {
      cancelTransactionFailedPopup({
        text: error instanceof Error ? error.message : undefined,
        onClose: () => onClose({}),
      });
    }
  };

  const handleCheckStatus = async (onClose: (event: any) => void) => {
    // Legacy fallback: no operationId but we have a token
    if (!currentTransaction.operationId) {
      if (!token) {
        tokenCannotCheckStatusPopup({ onClose: () => onClose({}) });
        return;
      }
      setIsCheckingStatus(true);
      try {
        const mintUrl = currentTransaction.mintUrl;
        if (!mintUrl) throw new Error('Missing mint URL');

        const wallet = await manager.walletService.getWallet(mintUrl);
        const proofStates = await wallet.checkProofsStates(
          token.proofs.map((p) => ({ secret: p.secret }))
        );

        const spentCount = proofStates.filter((s) => s.state === 'SPENT').length;
        const unspentCount = proofStates.filter((s) => s.state === 'UNSPENT').length;
        const pendingCount = proofStates.filter((s) => s.state === 'PENDING').length;
        const total = proofStates.length;

        if (spentCount === total) {
          await updateLegacyHistoryState(
            currentTransaction,
            'finalized',
            mintUrl,
            manager,
            accountIndex
          );
          tokenRedeemedPopup({ onClose: () => onClose({}) });
        } else if (unspentCount === total) {
          tokenStillPendingPopup({ onClose: () => onClose({}) });
        } else {
          tokenMixedStatesPopup(
            { spent: spentCount, unspent: unspentCount, pending: pendingCount, total },
            { onClose: () => onClose({}) }
          );
        }
      } catch (error) {
        tokenCheckFailedPopup({
          text: error instanceof Error ? error.message : String(error),
          onClose: () => onClose({}),
        });
      } finally {
        setIsCheckingStatus(false);
      }
      return;
    }

    // Normal path: operationId exists
    setIsCheckingStatus(true);
    try {
      const operation = await manager.send.getOperation(currentTransaction.operationId);
      if (!operation) {
        operationNotFoundPopup({ onClose: () => onClose({}) });
        return;
      }

      if (operation.state === 'finalized') {
        tokenRedeemedByRecipientPopup({ onClose: () => onClose({}) });
        return;
      }

      if (operation.state === 'rolled_back') {
        transactionAlreadyCancelledPopup({ onClose: () => onClose({}) });
        return;
      }

      if (operation.state !== 'pending') {
        operationInvalidStatePopup({ state: operation.state }, { onClose: () => onClose({}) });
        return;
      }

      await manager.send.checkPendingOperation(currentTransaction.operationId);

      const updatedOperation = await manager.send.getOperation(currentTransaction.operationId);
      if (updatedOperation?.state === 'finalized') {
        tokenRedeemedByRecipientPopup({ onClose: () => onClose({}) });
      } else {
        tokenPendingNotRedeemedPopup({ onClose: () => onClose({}) });
      }
    } catch (error) {
      tokenCheckFailedPopup({
        text: error instanceof Error ? error.message : undefined,
        onClose: () => onClose({}),
      });
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // --- Render ---

  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            {
              text: 'Close',
              icon: 'mdi:close-circle',
              variant: 'secondary',
              onPress: async () => onNavigateBack(),
              condition: isPaid,
            },
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: handleCopy,
              condition: !isPaid && !!token,
            },
            {
              text: 'Share',
              icon: 'mdi:share-variant',
              variant: 'secondary',
              onPress: handleShare,
              condition: !isPaid && !!token,
            },
            {
              text: 'NFC',
              icon: 'lucide:nfc',
              variant: 'secondary',
              onPress: handleNFCSend,
              condition: !isPaid && !!token,
            },
            {
              text: 'Copy as Emoji',
              icon: 'fluent:emoji-24-filled',
              variant: 'primary',
              pushSheet: {
                sheetId: 'emoji-picker',
                payload: { token: formattedToken },
              },
              condition: !isPaid && !!token,
            },
            {
              text: isCheckingStatus ? 'Checking...' : 'Check Status',
              icon: 'mdi:refresh',
              variant: 'secondary',
              onPress: handleCheckStatus,
              condition: !isPaid && !!token && currentTransaction.state === 'pending',
            },
            {
              text: 'Cancel Transaction',
              icon: 'mdi:cancel',
              variant: 'dangerous',
              onPress: handleCancelSend,
              condition: !isPaid && !!token && !!currentTransaction.operationId,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        <HistoryEntryHeader historyEntry={currentTransaction} />

        {!isPaid && token && (
          <PaymentInfo
            copyTarget="ecashToken"
            unit={currentTransaction.unit}
            data={formattedToken}
            animated={isLongToken}
          />
        )}

        {mintInfo && <HistoryEntryRefresh historyEntry={currentTransaction} mintInfo={mintInfo} />}

        <HistoryEntryTimeline historyEntry={currentTransaction} />

        <DetailsSection
          items={[
            ...(sourceLabel ? [{ title: 'Source', value: sourceLabel }] : []),
            {
              title: 'Date',
              value: convertTime(new Date(currentTransaction.createdAt)),
            },
            ...(token
              ? [
                  {
                    title: 'Token',
                    value: truncateMiddle(getEncodedTokenV4(token), 6),
                  },
                ]
              : []),
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
