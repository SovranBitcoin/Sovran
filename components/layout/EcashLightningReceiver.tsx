import React, { useCallback } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { checkIfAlreadyRedeemed, isValidEcashToken } from 'helper/cashuClient';
import Modal from 'components/layout/Modal';
import { SimplePool } from 'nostr-tools';
import { PaymentInfo } from '../layout/PaymentInfo';
import { useNostr } from 'helper/redux/nostr';
import { useCameraPermissions } from 'expo-camera';
import { getGiveaway } from 'app/ecashReceiveConfirmation';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { useTypedNavigation } from 'helper/navigation';
import { decode, isEncoded } from 'helper/third-party/emoji';
import { Card } from 'components/common/Card';
import { useGetMintInfo } from 'helper/redux/cashu';
import { getProfile } from 'app/(drawer)/(tabs)';
import { useTransactions } from 'components/providers/TransactionsProvider';
import { TransactionMintRefresh } from 'components/common/Transaction/TransactionMintRefresh';
import { Spacer } from 'components/common/View';
import { RowButton, Section } from 'app/settings';
import Icon from 'assets/icons';
import { Text } from 'components/common/Text';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { greys } from 'helper/colors';
import { truncateMiddle } from 'helper/strings';

export const pool = new SimplePool();

type UnitType = 'sat' | string;

interface EcashLightningReceiverProps {
  unit: UnitType;
  type?: string;
}

interface TokenHandlerParams {
  token: string;
}

/**
 * Component for receiving Bitcoin or other cryptocurrency via Lightning or Ecash
 */
const EcashLightningReceiver = ({ unit }: EcashLightningReceiverProps) => {
  const navigation = useTypedNavigation();
  const { currentProfile } = useNostr();
  const theme = useSelector(memoizedGetTheme);
  const [hasPermission, requestPermission] = useCameraPermissions();

  /**
   * Handles ecash token processing and navigation
   */
  const handleEcashToken = ({ token }: TokenHandlerParams): void => {
    const giveaway = getGiveaway({ token });

    if (giveaway?.id) {
      // Check if already redeemed
      if (checkIfAlreadyRedeemed(token)) {
        showMessage('already_redeemed', {}, { emoji: '🚨' });
        return;
      }

      if (!giveaway.condition()) {
        showMessage('general_error', {}, { emoji: '🚨' });
        return;
      }
    }

    navigation.navigate('ecashReceiveConfirmation', {
      token,
      unit,
    });
  };

  /**
   * Handles pasting ecash tokens from clipboard
   */
  const handleEcashPaste = async (): Promise<void> => {
    // const hasReadPermission = await Clipboard.hasStringAsync();

    // if (!hasReadPermission) {
    //   showMessage('clipboard_permission_denied', {}, { emoji: '🚨' });
    //   return;
    // }

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
  const handleScanQR = (): void => {
    if (!hasPermission?.granted) {
      requestPermission();
      return;
    }

    navigation.navigate('camera', { unit });
  };

  /**
   * Handles fixed amount button press
   */
  const handleFixedAmount = (): void => {
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

  const mintInfo = useGetMintInfo({ mintUrl: 'https://mint.minibits.cash/Bitcoin' });

  const { listenToTransaction } = useTransactions();

  return (
    <Modal
      showClose
      title={formattedTitle}
      buttons={
        <View className="flex-row items-center justify-center bg-transparent pb-2">
          <ButtonHandler
            // helpButton={{
            //   text: 'Copy Npub',
            // }}
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
              // {
              //   text: "Customize Lightning Address",
              //   icon: "mdi:at",
              //   variant: "secondary",
              //   onPress: () => {
              //     navigation.navigate("settings/customNpub");
              //   },
              // },
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
            <Card
              message="The receive address from NPUBX below is an experimental feature, ensure you keep your app up-to-date for possible breaking changes."
              variant="warning"
            />
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
            transaction={{
              transactionType: 'receive',
            }}
            handleCheckStatus={async (callback) => {
              await getProfile(currentProfile, listenToTransaction);
              callback();
            }}
          />
        )}
      </View>
    </Modal>
  );
};

export default EcashLightningReceiver;
