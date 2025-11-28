/**
 * @fileoverview Shared Receive screen component
 *
 * This module provides the core UI and logic for receiving ecash/Lightning.
 * It is used by both standalone and flow-based route wrappers.
 */

import React, { useCallback, useState, useEffect } from 'react';
import { ScrollView } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useMintManagement } from 'hooks/coco';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { useCameraPermissions } from 'expo-camera';
import { popup } from '@/helper/popup';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { decode, isEncoded } from 'helper/third-party/emoji';
import { HistoryEntryRefresh } from 'components/blocks/Transaction/HistoryEntryRefresh';
import { View } from 'components/ui/View';
import { RowButton, Section } from 'app/settings-pages';
import Icon from 'assets/icons';
import { getDecodedToken, type ReceiveHistoryEntry } from 'coco-cashu-core';
import { Text } from 'components/ui/Text';
import { useTheme } from 'providers/ThemeProvider';
import { truncateMiddle } from 'helper/strings';
import { Proof } from '@cashu/cashu-ts';
import { isValidEcashToken } from '@/helper/coco/utils';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { BottomButtons } from 'components/ui/BottomButtons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export interface ReceiveScreenProps {
  unit: string;
  onReceiveToken: (receiveHistoryEntry: ReceiveHistoryEntry & { token: string }) => void;
  onCamera: (unit: string) => void;
  onFixedAmount: (unit: string) => void;
}

export function ReceiveScreen({
  unit,
  onReceiveToken,
  onCamera,
  onFixedAmount,
}: ReceiveScreenProps) {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();
  const [hasPermission, requestPermission] = useCameraPermissions();
  const { getMintInfo } = useMintManagement();
  const { keys: nostrKeys } = useNostrKeysContext();

  const [mintInfo, setMintInfo] = useState<any>(null);

  useEffect(() => {
    const loadMintInfo = async () => {
      try {
        const info = await getMintInfo('https://mint.minibits.cash/Bitcoin');
        setMintInfo(info);
      } catch (error) {
        console.error('Failed to load mint info:', error);
      }
    };
    loadMintInfo();
  }, [getMintInfo]);

  const handleEcashToken = ({ token }: { token: string }): void => {
    const receiveHistoryEntry: ReceiveHistoryEntry & { token: string } = {
      id: `receive-${Date.now()}`,
      type: 'receive',
      amount: getDecodedToken(token).proofs.reduce(
        (sum: number, proof: Proof) => sum + proof.amount,
        0
      ),
      unit: unit,
      mintUrl: getDecodedToken(token).mint,
      createdAt: Date.now(),
      metadata: {},
      token: token,
    };

    onReceiveToken(receiveHistoryEntry);
  };

  const handleEcashPaste = async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();

    let decodedText;
    if (isEncoded(text)) {
      decodedText = decode(text);
    } else {
      decodedText = text;
    }

    if (!decodedText) {
      popup({ message: 'no_clipboard_address', emoji: '🚨', type: 'error' });
      return;
    }

    if (!isValidEcashToken(decodedText)) {
      popup({
        message: 'invalid_address',
        params: { address: decodedText },
        emoji: '🚨',
        type: 'error',
      });
      return;
    }

    handleEcashToken({ token: decodedText });
  };

  const handleScanQR = async (): Promise<void> => {
    if (!hasPermission?.granted) {
      await requestPermission();
      return;
    }

    onCamera(unit);
  };

  const handleFixedAmount = async (): Promise<void> => {
    onFixedAmount(unit);
  };

  const handleCopyLightningAddress = useCallback(async () => {
    await EnhancedHaptics.copyHaptic();
    await Clipboard.setStringAsync(`${nostrKeys?.npub}@npubx.cash`);
    popup({ message: 'lightning_address_copied', type: 'success' });
  }, [nostrKeys?.npub]);

  const formattedTitle = `Receive ${unit === 'sat' ? 'Bitcoin' : (unit || 'SAT').toUpperCase()}`;
  const showLightningAddress = Boolean(nostrKeys?.npub && unit === 'sat');

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
          paddingBottom: 120,
        }}>
        {showLightningAddress && (
          <PaymentInfo
            data={`${nostrKeys?.npub}@npubx.cash`}
            popupMessage="lightning_address_copied"
            unit="sat"
          />
        )}
        {showLightningAddress && (
          <View style={{ marginHorizontal: 16 }}>
            <Section title="RECEIVE ADDRESS">
              <RowButton
                label={
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="mingcute:lightning-fill" size={20} color={getPrimaryColor('400')} />
                    <Text style={{ marginLeft: 8 }} className="text-primary-50" bold>
                      {truncateMiddle(nostrKeys?.npub || '', 7)}@npubx.cash
                    </Text>
                  </View>
                }
                isFirst
                onPress={handleCopyLightningAddress}
                rightIcon={<Icon name="lets-icons:copy" size={20} color={getPrimaryColor('400')} />}
              />
            </Section>
          </View>
        )}

        {showLightningAddress && (
          <HistoryEntryRefresh
            mintInfo={mintInfo}
            historyEntry={{
              type: 'receive',
              mintUrl: mintInfo?.mintUrl,
            }}
          />
        )}
      </ScrollView>

      <BottomButtons>
        <View className="flex-row items-center justify-center bg-transparent pb-2">
          <ButtonHandler
            buttons={[
              {
                text: 'Paste',
                icon: 'lets-icons:copy',
                variant: 'primary',
                onPress: handleEcashPaste,
              },
              {
                text: 'Fixed Amount',
                icon: 'mdi:decimal',
                variant: 'secondary',
                onPress: handleFixedAmount,
              },
              {
                text: 'Scan QR',
                icon: 'stash:qr-code',
                variant: 'secondary',
                onPress: handleScanQR,
              },
            ]}
          />
        </View>
      </BottomButtons>
    </View>
  );
}

export function getFormattedReceiveTitle(unit: string): string {
  return `Receive ${unit === 'sat' ? 'Bitcoin' : (unit || 'SAT').toUpperCase()}`;
}
