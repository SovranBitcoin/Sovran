/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * This module provides the core UI and logic for receiving ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useState, useEffect } from 'react';
import { popup } from '@/helper/popup';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { HistoryEntryTimeline } from 'components/blocks/Transaction/HistoryEntryTimeline';
import { TransactionLocationSection } from 'components/blocks/TransactionLocationSection';
import { VStack } from 'components/ui/View/VStack';
import { View } from 'components/ui/View/View';
import { Text } from 'components/ui/Text';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ModalLayoutWrapper } from 'app/debugModal';
import { useHistoryEntry } from '@/hooks/coco/useHistoryEntry';
import { useMintManagement } from '@/hooks/coco/useMintManagement';
import { useReceive, useManager } from 'coco-cashu-react';
import { captureAndStoreLocation } from '@/hooks/useTransactionLocation';
import { useScanHistoryStore } from 'stores/scanHistoryStore';

interface ReceiveTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  receiveHistoryEntry: ReceiveHistoryEntry | string | undefined;
  onNavigateBack: () => void;
  onRedeemSuccess: () => void;
}

/** Error screen shown when transaction data is missing or invalid */
function ErrorState({ message, onNavigateBack }: { message: string; onNavigateBack: () => void }) {
  return (
    <ModalLayoutWrapper>
      <View style={{ flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center' }}>
        <Text>{message}</Text>
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
  // Holds the real history entry id after redeem (for location lookup)
  const [finalizedTransactionId, setFinalizedTransactionId] = useState<string | null>(null);

  // Use the generic history entry hook for parsing, state, and event subscription
  const { entry: receiveHistoryEntry, error: parseError } =
    useHistoryEntry<ReceiveHistoryEntry>(receiveHistoryEntryProp);

  const tokenString = receiveHistoryEntry?.token
    ? manager.wallet.encodeToken(receiveHistoryEntry.token)
    : undefined;

  // Detect if this is a scan placeholder (created by useProcessPaymentString before redeem)
  const isScanPlaceholder = receiveHistoryEntry?.id?.startsWith('receive-') ?? false;
  // Entry is finalized if it's a real history entry (not scan placeholder) or has been redeemed
  const isFinalizedReceive = !isScanPlaceholder || isRedeemed;

  // Determine the state: pending until redeemed locally
  const receiveState = isRedeemed ? 'redeemed' : 'pending';

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
    try {
      if (!tokenString) {
        throw new Error('Missing token data');
      }

      await receive(tokenString);

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
      SheetManager.show('mint-accepter', {
        payload: { mint: receiveHistoryEntry.mintUrl },
        onClose: async (result) => {
          if (result?.trusted) {
            await handleRedeem();
          }
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
            condition: isRedeemed,
          },
          {
            text: 'Cancel',
            variant: 'secondary',
            onPress: async () => handleCancel(),
            condition: !isRedeemed,
          },
          {
            text: 'Redeem Ecash',
            variant: 'primary',
            onPress: handleRedeemPress,
            loading: loading,
            condition: !!tokenString && !isRedeemed,
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

        <Section
          items={[
            { title: 'Type', value: 'Ecash • Receive' },
            ...(tokenString ? [{ title: 'Token', value: truncateMiddle(tokenString, 6) }] : []),
          ]}
          camera={false}
        />

        <TransactionDebugCode historyEntry={receiveHistoryEntry} />
      </VStack>
    </ModalLayoutWrapper>
  );
}
