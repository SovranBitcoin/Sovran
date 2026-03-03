/**
 * @fileoverview Shared SendToken screen component
 *
 * This module provides the core UI and logic for sending ecash tokens.
 * It supports two modes in a unified component:
 * 1. Normal mode: Token already created, shows QR code for sharing
 * 2. Payment request mode: No token yet, shows confirmation UI with Send button
 *
 * Both modes share the same layout structure for smooth transitions.
 * Payment request mode handles NUT-18 payment requests with Nostr transport.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Share } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import * as SQLite from 'expo-sqlite';

import { useSubscribe } from '@nostr-dev-kit/ndk-mobile';
import {
  getEncodedTokenV4,
  decodePaymentRequest,
  PaymentRequestTransportType,
  PaymentRequestPayload,
  Token,
} from '@cashu/cashu-ts';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useReceive, useManager } from 'coco-cashu-react';
import { nip19 } from 'nostr-tools';
import { Metadata } from 'nostr-tools/kinds';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { SheetManager } from 'react-native-actions-sheet';

import {
  HistoryEntryHeader,
  useTransactionSource,
  useHistoryEntry,
  HistoryEntryRefresh,
  HistoryEntryTimeline,
  TransactionLocationSection,
} from '@/features/transactions';
import {
  nfcEcashSharedPopup,
  nfcConnectionLostPopup,
  nfcSendFailedPopup,
  copyPopup,
  tokenCannotCancelPopup,
  tokenAlreadyRedeemedPopup,
  tokenCannotReclaimPopup,
  fundsReclaimedPopup,
  reclaimFailedPopup,
  transactionCancelledPopup,
  tokenCannotCheckStatusPopup,
  tokenRedeemedPopup,
  tokenStillPendingPopup,
  tokenMixedStatesPopup,
  tokenCheckFailedPopup,
  tokenRedeemedByRecipientPopup,
  transactionAlreadyCancelledPopup,
  tokenPendingNotRedeemedPopup,
  nostrPaymentSentPopup,
  cancelTransactionFailedPopup,
  operationNotFoundPopup,
  operationInvalidStatePopup,
  invalidPaymentRequestPopup,
  sendPaymentFailedPopup,
} from '@/shared/lib/popup';
import { useMintManagement } from '@/features/mint';
import { useSendWithHistory } from '@/features/send';
import { useNostrDirectMessage } from '@/features/user';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { ModalLayoutWrapper } from '@/shared/ui/composed/ModalLayoutWrapper';
import { PaymentInfo } from '@/shared/blocks/PaymentInfo';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { Card } from '@/shared/ui/composed/Card';
import { DetailsSection } from '@/shared/ui/composed/DetailsSection';
import { ScreenErrorState, ScreenLoadingState } from '@/shared/ui/composed/ScreenStates';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { writeTokenToNFC } from '@/shared/lib/nfc';
import { truncateMiddle } from '@/shared/lib/strings';
import { convertTime } from '@/shared/lib/time';
import { useMintInfo } from '@/shared/hooks/useMintInfo';

// Default relay for payment requests
const DEFAULT_PAYMENT_RELAY = 'wss://relay.vertexlab.io';

const FALLBACK_PAYMENT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.8333.space/',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

/**
 * Update state for a legacy send history entry (no operationId).
 *
 * Legacy entries (pre-Dec 2025) have operationId = NULL in the DB. Coco's
 * update methods all key on (mintUrl, operationId), and NULL = NULL is false
 * in SQL, so they can never match these rows.
 *
 * We open the same coco.db directly and UPDATE by the row's primary key `id`,
 * then emit `history:updated` so usePaginatedHistory re-fetches from the
 * now-updated DB.
 */
async function updateLegacyHistoryState(
  entry: SendHistoryEntry,
  state: string,
  mintUrl: string,
  manager: ReturnType<typeof useManager>
) {
  if (!entry.id) return;
  try {
    const db = SQLite.openDatabaseSync('coco.db');
    db.runSync(`UPDATE coco_cashu_history SET state = ? WHERE id = ? AND type = 'send'`, [
      state,
      Number(entry.id),
    ]);
    // Emit so the UI refreshes from the updated DB
    await manager.historyService.handleHistoryUpdated(mintUrl, { ...entry, state } as any);
  } catch (err) {
    console.warn('[SendTokenScreen] Failed to update legacy history state:', err);
  }
}

/** Payment request data for confirmation mode (no token yet) */
interface PaymentRequestData {
  encodedRequest: string;
  amount: number;
  mintUrl: string;
}

interface SendTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally (normal mode) */
  sendHistoryEntry?: SendHistoryEntry | string;
  /** Payment request data for confirmation mode (no token yet) */
  paymentRequest?: PaymentRequestData;
  /** Initial nostrSent state (true when coming from CurrencyScreen payment request flow) */
  initialNostrSent?: boolean;
  onNavigateBack: () => void;
}

export function SendTokenScreen({
  sendHistoryEntry: sendHistoryEntryProp,
  paymentRequest,
  initialNostrSent = false,
  onNavigateBack,
}: SendTokenScreenProps) {
  const { receive: _receive } = useReceive();
  const { isKnownMint } = useMintManagement();
  const manager = useManager();
  const { send, isSending } = useSendWithHistory();
  const { sendDirectMessage, isSending: isSendingDM } = useNostrDirectMessage();

  // State
  const [, setUri] = useState('');
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isSendingPayment, setIsSendingPayment] = useState(false);
  const [isMintTrusted, setIsMintTrusted] = useState<boolean | null>(null);

  // Track the created transaction + token when transitioning from payment request mode
  const [createdEntry, setCreatedEntry] = useState<SendHistoryEntry | null>(null);
  const [createdToken, setCreatedToken] = useState<Token | null>(null);
  // Track payment request timeline progress
  const [tokenCreated, setTokenCreated] = useState(initialNostrSent); // If nostr already sent, token was created
  const [nostrSent, setNostrSent] = useState(initialNostrSent);

  // Determine which entry to use - created entry takes precedence over prop
  const entryToUse = createdEntry || sendHistoryEntryProp;

  // Use the generic history entry hook for parsing, state, and event subscription
  const { entry: currentTransaction, error: parseError } =
    useHistoryEntry<SendHistoryEntry>(entryToUse);
  const sourceLabel = useTransactionSource(currentTransaction?.id);
  const resolvedMintUrl = currentTransaction?.mintUrl || paymentRequest?.mintUrl;
  const mintInfo = useMintInfo(resolvedMintUrl);

  // Determine mode: payment request mode if we have paymentRequest and no transaction yet
  const isPaymentRequestMode = !!paymentRequest && !currentTransaction;

  // Decode the payment request (only in payment request mode)
  const { decodedRequest, decodeError } = useMemo(() => {
    if (!paymentRequest?.encodedRequest) {
      return { decodedRequest: null, decodeError: null };
    }
    try {
      return {
        decodedRequest: decodePaymentRequest(paymentRequest.encodedRequest),
        decodeError: null,
      };
    } catch (err) {
      console.error('[SendTokenScreen] Failed to decode payment request:', err);
      return { decodedRequest: null, decodeError: 'Invalid payment request format' };
    }
  }, [paymentRequest?.encodedRequest]);

  // Extract nostr transport info
  const nostrTransport = useMemo(() => {
    if (!decodedRequest?.transport) return null;
    return decodedRequest.transport.find((t) => t.type === PaymentRequestTransportType.NOSTR);
  }, [decodedRequest]);

  // Decode the nprofile to get pubkey and relays
  const recipientInfo = useMemo((): { pubkey: string; relays: string[] } | null => {
    if (!nostrTransport?.target) return null;
    try {
      const decoded = nip19.decode(nostrTransport.target);
      if ((decoded.type as string) === 'nprofile') {
        const data = decoded.data as unknown as ProfilePointer;
        return {
          pubkey: data.pubkey,
          relays: data.relays || FALLBACK_PAYMENT_RELAYS,
        };
      }
    } catch (err) {
      console.error('[SendTokenScreen] Failed to decode nprofile:', err);
    }
    return null;
  }, [nostrTransport]);

  // Memoize relays array to prevent useSubscribe from restarting
  const subscribeRelays = useMemo(
    () => [DEFAULT_PAYMENT_RELAY, ...(recipientInfo?.relays || FALLBACK_PAYMENT_RELAYS)],
    [recipientInfo?.relays]
  );

  // Memoize the opts object to prevent infinite loop
  const subscribeOpts = useMemo(() => ({ relays: subscribeRelays }) as any, [subscribeRelays]);

  // Fetch recipient's Nostr profile (kind 0) - only when in payment request mode
  const profileFilters = useMemo(
    () =>
      recipientInfo?.pubkey && isPaymentRequestMode
        ? [
            {
              authors: [recipientInfo.pubkey],
              kinds: [Metadata],
              limit: 1,
            },
          ]
        : null,
    [recipientInfo?.pubkey, isPaymentRequestMode]
  );

  const { events: profileEvents, eose: profileEose } = useSubscribe({
    filters: profileFilters,
    opts: subscribeOpts,
  });

  // Parse profile data
  const profile = useMemo(() => {
    if (!profileEvents?.[0]) return null;
    try {
      return JSON.parse(profileEvents[0].content);
    } catch {
      return null;
    }
  }, [profileEvents]);

  const displayName =
    profile?.display_name ||
    profile?.name ||
    (recipientInfo?.pubkey ? truncateMiddle(recipientInfo.pubkey, 8) : 'Unknown');

  // Check mint trust status (separate from mint info loading)
  useEffect(() => {
    if (!resolvedMintUrl) return;
    let mounted = true;
    isKnownMint(resolvedMintUrl)
      .then((trusted) => {
        if (mounted) setIsMintTrusted(trusted);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [resolvedMintUrl, isKnownMint]);

  // Get the token - prefer createdToken, then currentTransaction.token
  const token = createdToken || currentTransaction?.token;

  // Token handlers
  const handleNFCSend = useCallback(
    async (close: (event: any) => void): Promise<void> => {
      if (!token) return;
      const writeResult = await writeTokenToNFC(getEncodedTokenV4(token));
      if (writeResult.success) {
        nfcEcashSharedPopup({ onClose: () => close({}) });
        return;
      }

      const operationId = currentTransaction?.operationId;
      const lostConnection =
        writeResult.errorCode === 'TAG_LOST' || writeResult.errorCode === 'TRANSCEIVE_FAILED';

      // If NFC delivery failed due lost connection, reclaim the pending send immediately.
      if (lostConnection && operationId) {
        try {
          await manager.send.rollback(operationId);
          nfcConnectionLostPopup();
          return;
        } catch (rollbackError) {
          console.error('[SendTokenScreen] NFC rollback failed:', rollbackError);
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
    },
    [token, currentTransaction?.operationId, manager]
  );

  const handleCopy = useCallback(
    async (onClose: (event: any) => void) => {
      if (!token) return;
      await Clipboard.setStringAsync(getEncodedTokenV4(token));
      copyPopup('ecashToken', { onClose: () => onClose({}) });
    },
    [token]
  );

  const handleShare = useCallback(
    async (onClose: (event: any) => void) => {
      if (!token) return;
      await Share.share({
        message: 'cashu://' + getEncodedTokenV4(token),
      });
      onClose({});
    },
    [token]
  );

  const handleCancelSend = useCallback(
    async (onClose: (event: any) => void) => {
      // --- Legacy fallback: no operationId but we have a token ---
      if (!currentTransaction?.operationId) {
        if (!token) {
          tokenCannotCancelPopup({ onClose: () => onClose({}) });
          return;
        }
        try {
          const mintUrl = currentTransaction?.mintUrl;
          if (!mintUrl) throw new Error('Missing mint URL');

          // Check proof states with the mint (NUT-07)
          const wallet = await manager.walletService.getWallet(mintUrl);
          const proofStates = await wallet.checkProofsStates(
            token.proofs.map((p) => ({ secret: p.secret }))
          );

          const allSpent = proofStates.every((s) => s.state === 'SPENT');
          if (allSpent) {
            await updateLegacyHistoryState(currentTransaction, 'finalized', mintUrl, manager);
            tokenAlreadyRedeemedPopup({ onClose: () => onClose({}) });
            return;
          }

          // Filter to only unspent proofs — mint rejects swaps containing spent proofs
          const unspentProofs = token.proofs.filter((_, i) => proofStates[i]?.state === 'UNSPENT');

          if (unspentProofs.length === 0) {
            // All proofs are PENDING at the mint
            tokenCannotReclaimPopup({ onClose: () => onClose({}) });
            return;
          }

          // Reclaim unspent proofs
          const reclaimToken: Token = { mint: token.mint, proofs: unspentProofs, unit: token.unit };
          await manager.wallet.receive(reclaimToken);
          await updateLegacyHistoryState(currentTransaction, 'rolledBack', mintUrl, manager);

          const amt = unspentProofs.reduce((s, p) => s + p.amount, 0);
          fundsReclaimedPopup(
            { amount: amt, unit: currentTransaction?.unit || 'sat' },
            { onClose: () => onClose({}) }
          );
        } catch (error) {
          console.error('[SendTokenScreen] Legacy cancel failed:', error);
          reclaimFailedPopup({
            text: error instanceof Error ? error.message : String(error),
            onClose: () => onClose({}),
          });
        }
        return;
      }

      // --- Normal path: operationId exists ---
      try {
        await manager.send.rollback(currentTransaction.operationId);
        transactionCancelledPopup({ onClose: () => onClose({}) });
      } catch (error) {
        cancelTransactionFailedPopup({
          text: error instanceof Error ? error.message : undefined,
          onClose: () => onClose({}),
        });
      }
    },
    [currentTransaction, manager, token]
  );

  const handleCheckStatus = useCallback(
    async (onClose: (event: any) => void) => {
      // --- Legacy fallback: no operationId but we have a token ---
      if (!currentTransaction?.operationId) {
        if (!token) {
          tokenCannotCheckStatusPopup({ onClose: () => onClose({}) });
          return;
        }
        setIsCheckingStatus(true);
        try {
          const mintUrl = currentTransaction?.mintUrl;
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
            await updateLegacyHistoryState(currentTransaction, 'finalized', mintUrl, manager);
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
          console.error('[SendTokenScreen] Legacy check status failed:', error);
          tokenCheckFailedPopup({
            text: error instanceof Error ? error.message : String(error),
            onClose: () => onClose({}),
          });
        } finally {
          setIsCheckingStatus(false);
        }
        return;
      }

      // --- Normal path: operationId exists ---
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
    },
    [currentTransaction, manager, token]
  );

  const handleCopyEmoji = useCallback(
    async (onClose: (event: any) => void) => {
      if (!token) return;
      SheetManager.show('emoji-picker', {
        payload: {
          token: getEncodedTokenV4(token),
        },
        onClose,
      });
    },
    [token]
  );

  // Handle send payment (payment request mode)
  const handleSendPayment = useCallback(async () => {
    if (!paymentRequest || !decodedRequest || !nostrTransport || !recipientInfo) {
      invalidPaymentRequestPopup();
      return;
    }

    setIsSendingPayment(true);

    try {
      // 1. Create ecash token using coco
      const { token: newToken, historyEntry } = await send(
        paymentRequest.mintUrl,
        paymentRequest.amount
      );

      // Mark token as created for timeline (Prepared step complete)
      setTokenCreated(true);
      setCreatedEntry(historyEntry);
      setCreatedToken(newToken);

      // 2. Build PaymentRequestPayload
      const payload: PaymentRequestPayload = {
        id: decodedRequest.id,
        mint: paymentRequest.mintUrl,
        unit: decodedRequest.unit || 'sat',
        proofs: newToken.proofs,
      };

      // 3. Send via NIP-17 direct message
      await sendDirectMessage(nostrTransport.target, JSON.stringify(payload), {
        additionalRelays: recipientInfo.relays,
      });

      // Mark Nostr as sent for timeline (Nostr Send step complete)
      setNostrSent(true);

      // 4. Capture location for the transaction
      await captureAndStoreLocation(historyEntry.id);

      // 5. Show success
      nostrPaymentSentPopup();
    } catch (err) {
      console.error('[SendTokenScreen] Failed to send payment:', err);
      sendPaymentFailedPopup({ text: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSendingPayment(false);
    }
  }, [paymentRequest, decodedRequest, nostrTransport, recipientInfo, send, sendDirectMessage]);

  // Error states for payment request mode
  if (isPaymentRequestMode) {
    if (decodeError) {
      return <ScreenErrorState message={decodeError} onGoBack={onNavigateBack} />;
    }
    if (!decodedRequest) {
      return (
        <ScreenErrorState message="Failed to decode payment request" onGoBack={onNavigateBack} />
      );
    }
    if (!nostrTransport) {
      return (
        <ScreenErrorState
          message="This payment request requires Nostr transport which is not available"
          onGoBack={onNavigateBack}
        />
      );
    }
    if (!recipientInfo) {
      return (
        <ScreenErrorState
          message="Invalid recipient in payment request"
          onGoBack={onNavigateBack}
        />
      );
    }
    // Loading state while fetching profile
    if (!profileEose) {
      return <ScreenLoadingState message="Loading payment request..." />;
    }
  }

  // Error state for normal mode without transaction
  if (!isPaymentRequestMode && (parseError || !currentTransaction)) {
    return (
      <ScreenErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onGoBack={onNavigateBack}
      />
    );
  }

  // Derive display values
  const unit = currentTransaction?.unit ?? decodedRequest?.unit ?? 'sat';
  const mintUrl =
    currentTransaction?.mintUrl ?? paymentRequest?.mintUrl ?? decodedRequest?.mints?.[0] ?? '';

  const formattedToken = token ? getEncodedTokenV4(token) : '';
  const isLongToken = formattedToken.length >= 500;

  const isPaid =
    currentTransaction?.state === 'finalized' || currentTransaction?.state === 'rolledBack';

  const isLoading = isSending || isSendingDM || isSendingPayment;

  // Build buttons based on mode
  const bottomButtons = (
    <BottomButtons>
      <HStack justify="center" align="center">
        <ButtonHandler
          buttons={[
            // Payment request mode button (single Send Payment button)
            {
              text: isLoading ? 'Sending...' : 'Send Payment',
              variant: 'primary',
              icon: 'mdi:send',
              onPress: handleSendPayment,
              loading: isLoading,
              condition: isPaymentRequestMode,
            },
            // Normal mode buttons
            {
              text: 'Close',
              icon: 'ri:close-circle-line',
              variant: 'secondary',
              onPress: async () => onNavigateBack(),
              condition: !isPaymentRequestMode && isPaid,
            },
            {
              text: 'Copy',
              icon: 'lets-icons:copy',
              variant: 'primary',
              onPress: handleCopy,
              condition: !isPaymentRequestMode && !isPaid && !!token,
            },
            {
              text: 'Share',
              icon: 'ri:share-fill',
              variant: 'secondary',
              onPress: handleShare,
              condition: !isPaymentRequestMode && !isPaid && !!token,
            },
            {
              text: 'NFC',
              icon: 'ph:contactless-payment-fill',
              variant: 'secondary',
              onPress: handleNFCSend,
              condition: !isPaymentRequestMode && !isPaid && !!token,
            },
            {
              text: 'Copy as Emoji',
              icon: 'fluent:emoji-24-filled',
              variant: 'primary',
              onPress: handleCopyEmoji,
              condition: !isPaymentRequestMode && !isPaid && !!token,
            },
            {
              text: isCheckingStatus ? 'Checking...' : 'Check Status',
              icon: 'mdi:refresh',
              variant: 'secondary',
              onPress: handleCheckStatus,
              condition:
                !isPaymentRequestMode &&
                !isPaid &&
                !!token &&
                currentTransaction?.state === 'pending',
            },
            {
              text: 'Cancel Transaction',
              icon: 'mdi:cancel',
              variant: 'dangerous',
              onPress: handleCancelSend,
              condition: !isPaymentRequestMode && !isPaid && !!token,
            },
          ]}
        />
      </HStack>
    </BottomButtons>
  );

  // Build recipient profile for header (if in payment request mode or transitioning)
  const recipientProfile =
    recipientInfo && (isPaymentRequestMode || createdEntry)
      ? {
          pubkey: recipientInfo.pubkey,
          picture: profile?.picture,
          displayName,
        }
      : undefined;

  return (
    <ModalLayoutWrapper contentPadding={0} bottomContent={bottomButtons}>
      <VStack gap={12}>
        {/* Header - uses HistoryEntryHeader for both modes */}
        <HistoryEntryHeader
          historyEntry={currentTransaction || undefined}
          pendingData={
            isPaymentRequestMode && paymentRequest
              ? {
                  amount: paymentRequest.amount,
                  unit: decodedRequest?.unit || 'sat',
                  type: 'send',
                }
              : undefined
          }
          recipientProfile={recipientProfile}
          isLoading={isLoading}
        />

        {/* Description if provided (payment request mode) */}
        {isPaymentRequestMode && decodedRequest?.description && (
          <View className="px-4">
            <Card variant="info" message={decodedRequest.description} />
          </View>
        )}

        {/* Mint Trust Warning (payment request mode) */}
        {isPaymentRequestMode && isMintTrusted === false && (
          <View className="px-4">
            <Card
              variant="warning"
              message={`Warning: The requested mint (${truncateMiddle(mintUrl, 20)}) is not in your trusted mints. You may need to add it first.`}
            />
          </View>
        )}

        {/* Payment Info QR Code (normal mode with token) */}
        {!isPaymentRequestMode && !isPaid && token && (
          <PaymentInfo
            setUri={setUri}
            copyTarget="ecashToken"
            unit={unit}
            data={formattedToken}
            animated={isLongToken}
          />
        )}
        {/* Transaction Location (completed transactions) */}
        {!isPaymentRequestMode && isPaid && currentTransaction && (
          <TransactionLocationSection transactionId={currentTransaction.id} />
        )}

        {/* Mint info - shows in both modes since mint is selected in previous step */}
        {mintInfo && (
          <HistoryEntryRefresh
            historyEntry={currentTransaction || { type: 'send' as const }}
            mintInfo={mintInfo}
          />
        )}

        {/* Timeline - shows in both modes */}
        {(currentTransaction || (isPaymentRequestMode && paymentRequest)) && (
          <HistoryEntryTimeline
            historyEntry={
              currentTransaction || {
                type: 'send' as const,
                state: 'prepared' as const,
                id: '',
                createdAt: Date.now(),
                amount: paymentRequest?.amount || 0,
                unit: decodedRequest?.unit || 'sat',
                mintUrl: paymentRequest?.mintUrl || '',
                operationId: '',
              }
            }
            tokenCreated={paymentRequest ? tokenCreated : undefined}
            nostrSent={nostrSent}
          />
        )}

        {/* Technical details - collapsed by default */}
        <DetailsSection
          items={[
            ...(sourceLabel ? [{ title: 'Source', value: sourceLabel }] : []),
            // Payment request mode items
            ...(isPaymentRequestMode && recipientInfo
              ? [
                  {
                    title: 'Recipient',
                    value: truncateMiddle(recipientInfo.pubkey, 10),
                  },
                ]
              : []),
            // Normal mode items
            ...(!isPaymentRequestMode && currentTransaction
              ? [
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
                ]
              : []),
            // Payment request ID
            ...(isPaymentRequestMode && decodedRequest?.id
              ? [
                  {
                    title: 'Request ID',
                    value: truncateMiddle(decodedRequest.id, 10),
                  },
                ]
              : []),
          ]}
        />
      </VStack>
    </ModalLayoutWrapper>
  );
}
