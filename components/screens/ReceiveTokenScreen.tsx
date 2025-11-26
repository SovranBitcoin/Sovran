/**
 * @fileoverview Shared ReceiveToken screen component
 *
 * This module provides the core UI and logic for receiving ecash tokens.
 * It is used by both standalone and flow-based route wrappers.
 */

import { Alert, ScrollView } from 'react-native';
import React, { useState, useEffect } from 'react';
import { useMintManagement, useReceive } from 'hooks/coco';
import { popup } from '@/helper/popup';
import { SheetManager } from 'react-native-actions-sheet';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Section } from 'components/ui/Section';
import { truncateMiddle } from 'helper/strings';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { TransactionDebugCode } from 'components/blocks/Transaction/TransactionDebugCode';
import { VStack, View } from 'components/ui/View';
import type { ReceiveHistoryEntry } from 'coco-cashu-core';
import { HistoryEntryHeader } from '@/components/blocks/Transaction/HistoryEntryHeader';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useTheme } from 'providers/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ReceiveTokenScreenProps {
  receiveHistoryEntry: ReceiveHistoryEntry & { token?: string };
  onNavigateBack: () => void;
  onRedeemSuccess: () => void;
}

export function ReceiveTokenScreen({
  receiveHistoryEntry,
  onNavigateBack,
  onRedeemSuccess,
}: ReceiveTokenScreenProps) {
  const { receive } = useReceive();
  const { isKnownMint, getMintInfo } = useMintManagement();
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

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

