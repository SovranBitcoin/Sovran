import { Dimensions, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { greys, shades } from 'helper/colors';
import { isValidEcashToken } from 'components/cashu';
import Modal from 'components/layout/Modal';
import { SimplePool } from 'nostr-tools';
import { PaymentInfo } from '../layout/PaymentInfo';
import { useNostr } from 'helper/redux/nostr';
import { useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useCameraPermissions } from 'expo-camera';
import { getGiveaway } from 'app/ecashReceiveConfirmation';
import { checkIfAlreadyRedeemed } from 'helper/payment-handler/handlers';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { useTypedNavigation } from 'helper/navigation';
import { decode, isEncoded } from 'helper/third-party/emoji';

export const pool = new SimplePool();

const screenWidth = Dimensions.get('window').width;
const boxSize = (screenWidth - 128) / 4;

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
const EcashLightningReceiver: React.FC<EcashLightningReceiverProps> = ({ unit, type }) => {
  const theme = useSelector(memoizedGetTheme);
  const navigation = useTypedNavigation();
  const { currentProfile } = useNostr();
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
        const e = giveaway.error();
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
    const hasReadPermission = await Clipboard.hasStringAsync();

    if (!hasReadPermission) {
      showMessage('clipboard_permission_denied', {}, { emoji: '🚨' });
      return;
    }

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

  const formattedTitle = `Receive ${unit === 'sat' ? 'Bitcoin' : unit.toUpperCase()}`;
  const showLightningAddress = Boolean(currentProfile?.npub && unit === 'sat');

  return (
    <Modal
      showClose
      title={formattedTitle}
      buttons={
        <View className="flex-row items-center justify-center bg-transparent pb-2">
          <ButtonHandler
            buttons={[
              {
                text: 'Scan QR',
                icon: 'stash:qr-code',
                variant: 'secondary',
                onPress: handleScanQR,
              },
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
          <PaymentInfo
            data={`${currentProfile.npub}@npub.cash`}
            popupMessage="lightning_address_copied"
            unit="sat"
          />
        )}
      </View>
    </Modal>
  );
};

export default EcashLightningReceiver;

// Keeping styles for backward compatibility
const createStyles = (theme: any) =>
  StyleSheet.create({
    cornerBox: {
      position: 'absolute',
      width: boxSize,
      height: boxSize,
      borderRadius: 16,
      zIndex: 100,
      backgroundColor: 'transparent',
      overflow: 'hidden',
    },
    innerBorder: {
      position: 'absolute',
      borderWidth: 1,
      borderColor: greys(theme)[0],
      borderRadius: 16,
      zIndex: 100,
      backgroundColor: 'transparent',
      width: screenWidth - 128,
      height: screenWidth - 128,
    },
    barCodeScanner: {
      position: 'absolute',
      width: '100%',
      height: '100%',
    },
    input: {
      backgroundColor: greys(theme)[1800],
      color: greys(theme)[0],
      borderWidth: 1,
      borderColor: greys(theme)[1300],
      shadowColor: greys(theme)[2300],
      shadowOffset: { width: 1, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      borderRadius: 86,
      padding: 8,
      margin: 16,
      marginLeft: 16,
      marginRight: 16,
      marginTop: 8,
      marginBottom: 8,
      paddingLeft: 16,
      fontFamily: 'OverpassBold',
    },
    pasteButton: {
      position: 'absolute',
      right: 16,
      padding: 16,
      top: 0,
      bottom: 0,
    },
    pasteText: {
      color: shades[100],
      fontFamily: 'OverpassBold',
    },
    buttonRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      marginTop: 8,
    },
  });
