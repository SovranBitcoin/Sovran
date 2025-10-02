import React, { useCallback, useState, useEffect } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useCashuUtilities, useMintManagement } from 'hooks/coco';
import Modal from 'components/blocks/Modal';
import { SimplePool } from 'nostr-tools';
import { PaymentInfo } from 'components/blocks/PaymentInfo';
import { useNostr } from 'helper/redux/nostr';
import { useCameraPermissions } from 'expo-camera';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { decode, isEncoded } from 'helper/third-party/emoji';
import { Card } from 'components/ui/Card';
import { getProfile } from 'app/(drawer)/(tabs)';
import { useTransactions } from 'providers/CocoTransactionsProvider';
import { TransactionMintRefresh } from 'components/blocks/Transaction/TransactionMintRefresh';
import { Spacer } from 'components/ui/View';
import { RowButton, Section } from 'app/settings-pages';
import Icon from 'assets/icons';
import { Text } from 'components/ui/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { truncateMiddle } from 'helper/strings';
import { withSheetProvider } from 'hocs/withSheetProvider';

export const pool = new SimplePool();

interface TokenHandlerParams {
  token: string;
}

/**
 * Component for receiving Bitcoin or other cryptocurrency via Lightning or Ecash
 */
const EcashLightningReceiver = () => {
  const { unit } = useTypedRoute<'receive'>();
  const navigation = useTypedNavigation();
  const { currentProfile } = useNostr();
  const theme = useSelector(memoizedGetTheme);
  const [hasPermission, requestPermission] = useCameraPermissions();
  const { isValidEcashToken } = useCashuUtilities();
  const { getMintInfo } = useMintManagement();

  /**
   * Handles ecash token processing and navigation
   */
  const handleEcashToken = ({ token }: TokenHandlerParams): void => {
    // Note: Coco handles token redemption checking internally
    // The giveaway functionality was removed with Coco migration

    navigation.navigate('ecashReceiveConfirmation', {
      token,
      unit,
    });
  };

  /**
   * Handles pasting ecash tokens from clipboard
   */
  const handleEcashPaste = async (): Promise<void> => {
    const text = await Clipboard.getStringAsync();

    let decodedText;
    if (isEncoded(text)) {
      decodedText = decode(text);
    } else {
      decodedText = text;
    }

    if (!decodedText) {
      showMessage('no_clipboard_address', {}, { emoji: '🚨' });
      return;
    }

    if (!isValidEcashToken(decodedText)) {
      showMessage('invalid_address', { address: decodedText }, { emoji: '🚨' });
      return;
    }

    handleEcashToken({ token: decodedText });
  };

  /**
   * Handles scan QR button press and permissions
   */
  const handleScanQR = async (): Promise<void> => {
    if (!hasPermission?.granted) {
      await requestPermission();
      return;
    }

    navigation.navigate('camera', { unit });
  };

  /**
   * Handles fixed amount button press
   */
  const handleFixedAmount = async (): Promise<void> => {
    navigation.navigate('currency', {
      to: 'lightningReceiveConfirmation',
      unit,
    });
  };

  const handleCopyLightningAddress = useCallback(async () => {
    await Clipboard.setStringAsync(`${currentProfile.npub}@npubx.cash`);
    showMessage('lightning_address_copied');
  }, [currentProfile.npub]);

  const formattedTitle = `Receive ${unit === 'sat' ? 'Bitcoin' : unit.toUpperCase()}`;
  const showLightningAddress = Boolean(currentProfile?.npub && unit === 'sat');

  // Get mint info using Coco
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

  const { refresh } = useTransactions();

  return (
    <Modal
      showClose
      title={formattedTitle}
      buttons={
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
      }>
      <View>
        {showLightningAddress && (
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 0,
            }}>
            {new Date() > new Date('2025-07-22') && (
              <Card
                message="The receive address from NPUBX below is an experimental feature, ensure you keep your app up-to-date for possible breaking changes."
                variant="warning"
              />
            )}
            <Spacer size={12} />
          </View>
        )}

        {showLightningAddress && (
          <PaymentInfo
            data={`${currentProfile.npub}@npubx.cash`}
            popupMessage="lightning_address_copied"
            unit="sat"
            showSection={false}
          />
        )}
        {showLightningAddress && (
          <View
            style={{
              marginHorizontal: 16,
            }}>
            <Section title="RECEIVE ADDRESS">
              <RowButton
                label={
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon name="mingcute:lightning-fill" size={20} color={greys(theme)[400]} />
                    <Text style={{ marginLeft: 8, color: greys(theme)[50] }} bold>
                      {truncateMiddle(currentProfile.npub, 7)}@npubx.cash
                    </Text>
                  </View>
                }
                isFirst
                onPress={handleCopyLightningAddress}
                rightIcon={<Icon name="lets-icons:copy" size={20} color={greys(theme)[400]} />}
              />
            </Section>
          </View>
        )}

        {showLightningAddress && (
          <TransactionMintRefresh
            mintInfo={mintInfo}
            historyEntry={{
              type: 'receive',

              mintUrl: mintInfo?.mintUrl,
            }}
            handleCheckStatus={async (callback: () => void) => {
              await getProfile(currentProfile, refresh);
              callback();
            }}
          />
        )}
      </View>
    </Modal>
  );
};

export default withSheetProvider(EcashLightningReceiver);
