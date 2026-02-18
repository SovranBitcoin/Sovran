/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * This module provides the core UI and logic for receiving ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { popup } from '@/helper/popup';
import { router } from 'expo-router';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { DetailsSection } from 'components/ui/DetailsSection';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { TransactionLocationSection } from 'components/blocks/TransactionLocationSection';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import opacity from 'hex-color-opacity';
import { useTheme } from 'providers/ThemeProvider';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useHistoryEntry } from '@/hooks/coco/useHistoryEntry';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useReceive, useManager } from 'coco-cashu-react';
import { getDecodedToken } from '@cashu/cashu-ts';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';
import { useScanHistoryStore } from 'stores/scanHistoryStore';
import { useSettingsStore } from 'stores/settingsStore';
import { useTransactionSource } from '@/components/blocks/Transaction/TransactionSourceSection';

interface ReceiveTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  receiveHistoryEntry: ReceiveHistoryEntry | string | undefined;
  onNavigateBack: () => void;
  onRedeemSuccess: () => void;
}

/** Error screen shown when transaction data is missing or invalid */
function ErrorState({ message, onNavigateBack }: { message: string; onNavigateBack: () => void }) {
  const { getPrimaryColor } = useTheme();
  return (
    <ModalLayoutWrapper>
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Text color={opacity(getPrimaryColor('0'), 0.66)}>{message}</Text>
        <ButtonHandler
          buttons={[
            {
              text: 'Go Back',
              icon: 'ri:arrow-left-line',
              variant: 'primary',
              onPress: async () => onNavigateBack(),
            },
          ]}
        />
      </View>
    </ModalLayoutWrapper>
  );
}

export function ReceiveTokenScreen({
  receiveHistoryEntry: receiveHistoryEntryProp,
  onNavigateBack,
  onRedeemSuccess,
}: ReceiveTokenScreenProps) {
  const { receive } = useReceive();
  const manager = useManager();
  const { isKnownMint, getMintInfo } = useMintManagement();
  const [loading, setLoading] = useState(false);
  const [mintInfo, setMintInfo] = useState<any>({});
  const [isRedeemed, setIsRedeemed] = useState(false);
  const [isAlreadySpent, setIsAlreadySpent] = useState(false);
  // Holds the real history entry id after redeem (for location lookup)
  const [finalizedTransactionId, setFinalizedTransactionId] = useState<string | null>(null);

  // Use the generic history entry hook for parsing, state, and event subscription
  const { entry: receiveHistoryEntry, error: parseError } =
    useHistoryEntry<ReceiveHistoryEntry>(receiveHistoryEntryProp);
  const sourceLabel = useTransactionSource(finalizedTransactionId ?? receiveHistoryEntry?.id);

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

  // Detect if this is a scan placeholder (created by useProcessPaymentString before redeem)
  const isScanPlaceholder = receiveHistoryEntry?.id?.startsWith('receive-') ?? false;
  // A persisted receive history entry is already redeemed.
  const isPersistedReceive = !isScanPlaceholder;
  const effectiveIsRedeemed = isPersistedReceive || isRedeemed;
  const effectiveIsAlreadySpent = !effectiveIsRedeemed && isAlreadySpent;
  // Entry is finalized if it's a real history entry (not scan placeholder) or has been redeemed
  const isFinalizedReceive = isPersistedReceive || effectiveIsRedeemed;

  // Determine local UI state for timeline.
  const receiveState = effectiveIsRedeemed
    ? 'redeemed'
    : effectiveIsAlreadySpent
      ? 'alreadySpent'
      : 'pending';

  useEffect(() => {
    const loadMintInfo = async () => {
      if (receiveHistoryEntry?.mintUrl) {
        try {
          const info = await getMintInfo(receiveHistoryEntry.mintUrl);
          setMintInfo(info);
        } catch (error) {
          console.error('Failed to load mint info:', error);
          setMintInfo({});
        }
      } else {
        setMintInfo({});
      }
    };
    loadMintInfo();
  }, [receiveHistoryEntry?.mintUrl, getMintInfo]);

  // Reconcile "already redeemed" state:
  // - If this screen was opened from Transactions, the receive entry is persisted (non-placeholder id)
  //   and should immediately render as redeemed.
  // - If opened from a scan placeholder, try resolving to an already-linked/persisted receive entry.
  useEffect(() => {
    if (!receiveHistoryEntry) return;

    if (isPersistedReceive) {
      setIsRedeemed(true);
      if (receiveHistoryEntry.id) {
        setFinalizedTransactionId(receiveHistoryEntry.id);
      }
      return;
    }

    let cancelled = false;

    const resolveExistingRedeem = async () => {
      const rawToken = (receiveHistoryEntry.metadata as any)?.rawToken as string | undefined;
      const processedToken = rawToken || tokenString;

      // Search recent receive history entries for an exact token match.
      if (!tokenString) return;
      try {
        const recent = await manager.history.getPaginatedHistory(0, 200);
        const matchingReceive = recent.find((entry) => {
          if (entry.type !== 'receive' || !entry.token) return false;
          try {
            return manager.wallet.encodeToken(entry.token) === tokenString;
          } catch {
            return false;
          }
        });

        if (!matchingReceive?.id || cancelled) return;

        setFinalizedTransactionId(matchingReceive.id);
        setIsRedeemed(true);

        // Persist link for future quick lookups.
        if (processedToken) {
          useScanHistoryStore.getState().linkTransaction(processedToken, matchingReceive.id);
        }
      } catch (error) {
        console.error('Failed to resolve existing redeemed token:', error);
      }
    };

    resolveExistingRedeem();

    return () => {
      cancelled = true;
    };
  }, [receiveHistoryEntry, isPersistedReceive, tokenString, manager]);

  // Show error state if parsing failed
  if (parseError || !receiveHistoryEntry) {
    return (
      <ErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onNavigateBack={onNavigateBack}
      />
    );
  }

  const handleCancel = () => {
    onNavigateBack();
  };

  const handleRedeem = async () => {
    setLoading(true);
    setIsAlreadySpent(false);
    try {
      if (!tokenString) {
        throw new Error('Missing token data');
      }

      const decoded = getDecodedToken(tokenString);
      if (decoded.unit !== 'sat') {
        popup({
          message: `Unsupported token unit "${decoded.unit}". Only sat tokens can be redeemed.`,
          type: 'error',
        });
        setLoading(false);
        return;
      }

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

        // Store the real transaction id for location section lookup
        setFinalizedTransactionId(realEntry.id);
      }

      setIsRedeemed(true);
      popup({
        message: 'funds_received',
        params: { amount: receiveHistoryEntry.amount, unit: receiveHistoryEntry.unit },
        emoji: '🎉',
        onClose: onRedeemSuccess,
      });
    } catch (error) {
      console.error(error);
      const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
      const tokenAlreadySpent =
        errorMessage.includes('token already spent') ||
        errorMessage.includes('proof already spent') ||
        errorMessage.includes('already spent');
      if (tokenAlreadySpent) {
        setIsAlreadySpent(true);
      }
      popup({
        message: error instanceof Error ? error.message : 'Unknown error',
        type: 'error',
      });
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
            onPress: async () => handleCancel(),
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

        <HistoryEntryRefresh historyEntry={receiveHistoryEntry} mintInfo={mintInfo} />

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

        <TransactionDebugCode historyEntry={receiveHistoryEntry} />
      </VStack>
    </ModalLayoutWrapper>
  );
}
