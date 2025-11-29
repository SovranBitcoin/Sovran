/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * This module provides the core UI and logic for receiving ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 *
 * The Screen component handles:
 * - Parsing receiveHistoryEntry from string params
 * - Error states for missing/invalid data
 * - All UI and business logic
 */

import { Alert, ScrollView } from 'react-native';
import React, { useState, useEffect, useMemo } from 'react';
import { useMintManagement, useReceive } from 'hooks/coco';
import { popup } from '@/helper/popup';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { VStack, View } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ReceiveHistoryEntryWithToken = ReceiveHistoryEntry & { token?: string };

export interface ReceiveTokenScreenProps {
  /** Either the parsed entry or a JSON string to be parsed internally */
  receiveHistoryEntry: ReceiveHistoryEntryWithToken | string | undefined;
  onNavigateBack: () => void;
  onRedeemSuccess: () => void;
}

/** Error screen shown when transaction data is missing or invalid */
function ErrorState({
  message,
  onNavigateBack,
}: {
  message: string;
  onNavigateBack: () => void;
}) {
  const { getPrimaryColor } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
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
    </View>
  );
}

export function ReceiveTokenScreen({
  receiveHistoryEntry: receiveHistoryEntryProp,
  onNavigateBack,
  onRedeemSuccess,
}: ReceiveTokenScreenProps) {
  const { receive } = useReceive();
  const { isKnownMint, getMintInfo } = useMintManagement();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  // Parse receiveHistoryEntry - handles both string (from params) and object
  const { receiveHistoryEntry, parseError } = useMemo(() => {
    if (!receiveHistoryEntryProp) {
      return { receiveHistoryEntry: null, parseError: 'Missing transaction data. Please try again.' };
    }

    if (typeof receiveHistoryEntryProp === 'string') {
      try {
        return {
          receiveHistoryEntry: JSON.parse(receiveHistoryEntryProp) as ReceiveHistoryEntryWithToken,
          parseError: null,
        };
      } catch {
        return {
          receiveHistoryEntry: null,
          parseError: 'Invalid transaction data. Please try again.',
        };
      }
    }

    return { receiveHistoryEntry: receiveHistoryEntryProp, parseError: null };
  }, [receiveHistoryEntryProp]);

  // Show error state if parsing failed
  if (parseError || !receiveHistoryEntry) {
    return (
      <ErrorState
        message={parseError || 'Missing transaction data. Please try again.'}
        onNavigateBack={onNavigateBack}
      />
    );
  }

  const token = receiveHistoryEntry?.token;

  const [loading, setLoading] = useState(false);
  const [mintInfo, setMintInfo] = useState<any>({});

  useEffect(() => {
    const loadMintInfo = async () => {
      if (receiveHistoryEntry.mintUrl) {
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
  }, [receiveHistoryEntry.mintUrl, getMintInfo]);

  const handleCancel = () => {
    onNavigateBack();
  };

  const handleRedeem = async () => {
    setLoading(true);
    try {
      Alert.alert('Redeeming token', 'Redeeming token...');
      await receive(token as string);
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

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: 120,
        }}>
        <VStack gap={12}>
          <HistoryEntryHeader historyEntry={receiveHistoryEntry} />

          <HistoryEntryRefresh historyEntry={receiveHistoryEntry} mintInfo={mintInfo} />

          <Section
            items={[
              { title: 'Type', value: 'Ecash • Receive' },
              ...(token ? [{ title: 'Token', value: truncateMiddle(token, 6) }] : []),
            ]}
            camera={false}
          />

          <TransactionDebugCode historyEntry={receiveHistoryEntry} />
        </VStack>
      </ScrollView>

      <BottomButtons>
        <ButtonHandler
          buttons={[
            {
              text: 'Cancel',
              variant: 'secondary',
              onPress: async () => handleCancel(),
              condition: !('state' in receiveHistoryEntry && receiveHistoryEntry.state === 'PAID'),
            },
            {
              text: 'Redeem Ecash',
              variant: 'primary',
              onPress: handleRedeemPress,
              loading: loading,
              condition: !!token,
            },
          ]}
        />
      </BottomButtons>
    </View>
  );
}

