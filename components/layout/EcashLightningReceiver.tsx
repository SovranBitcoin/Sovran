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
import { ButtonHandler } from 'app/ecashSendConfirmation';
import { useTypedNavigation } from 'helper/navigation';

export const pool = new SimplePool();

const screenWidth = Dimensions.get('window').width;
const boxSize = (screenWidth - 128) / 4;

const EcashLightningReceiver = ({ unit, type }) => {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const navigation = useTypedNavigation();
  const { currentProfile } = useNostr();
  const [hasPermission, requestPermission] = useCameraPermissions();

  const handleEcashToken = ({ token }) => {
    const giveaway = getGiveaway({ token: token });
    if (giveaway?.id) {
      // Check if already redeemed
      if (checkIfAlreadyRedeemed(token)) {
        showMessage('already_redeemed', {}, { emoji: '🚨' });
        return;
      }
      if (giveaway.condition()) {
      } else {
        const e = giveaway.error();
        showMessage('general_error', {}, { emoji: '🚨' });
        return;
      }
    }

    navigation.navigate('ecashReceiveConfirmation', {
      token: token,
      unit,
    });
  };

  async function handleEcashPaste() {
    const hasReadPermission = await Clipboard.hasStringAsync();

    if (!hasReadPermission) {
      showMessage('clipboard_permission_denied', {}, { emoji: '🚨' });
      return;
    }

    const text = await Clipboard.getStringAsync();

    if (!isValidEcashToken(text)) {
      if (text) {
        showMessage('invalid_address', { address: text }, { emoji: '🚨' });
        return;
      } else {
        showMessage('no_clipboard_address', {}, { emoji: '🚨' });
        return;
      }
    } else {
      if (text) {
        handleEcashToken({ token: text });
      }
    }
  }

  return (
    <Modal
      showClose
      title={`Receive ${unit === 'sat' ? 'Bitcoin' : unit.toUpperCase()}`}
      buttons={
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'transrparent',
            paddingBottom: 8,
          }}>
          <ButtonHandler
            buttons={[
              {
                text: 'Scan QR',
                icon: 'stash:qr-code',
                variant: 'secondary',
                onPress: () => {
                  if (!hasPermission?.granted) {
                    requestPermission();
                    return;
                  }

                  navigation.navigate('camera', {
                    unit,
                  });
                },
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
                onPress: () => {
                  navigation.navigate('currency', {
                    to: 'lightningReceiveConfirmation',
                    unit,
                  });
                },
              },
              // {
              //   text: "Customize Lightning Address",
              //   icon: "mdi:at",
              //   variant: "secondary",
              //   onPress: () => {
              //     navigation.navigate("settings/customNpub");
              //   },
              // },
            ]}></ButtonHandler>
        </View>

        // <>
        //   <View
        //     style={{
        //       flexDirection: "row",
        //       justifyContent: "center",
        //       alignItems: "center",
        //       marginTop: 8,
        //     }}
        //   >
        //     <View
        //       style={{
        //         flex: 1,
        //       }}
        //     >
        //       {hasPermission?.granted ? (
        //         <Button
        //           variant={"secondary"}
        //           icon={<QRCodeIcon />}
        //           text={"Scan QR"}
        //           onPress={() =>
        //             navigation.navigate("camera", {
        //               unit,
        //             })
        //           }
        //           position="left"
        //         ></Button>
        //       ) : (
        //         <PermissionsButton
        //           description={`There was a problem accessing your camera. Please check the App permissions and try again.`}
        //           icon={<QRCodeIcon />}
        //           text="Scan QR"
        //           position="left"
        //         />
        //       )}
        //     </View>
        //     <View
        //       style={{
        //         flex: 1,
        //       }}
        //     >
        //       <Button
        //         variant={"secondary"}
        //         position={"right"}
        //         onPress={() => {
        //           navigation.navigate("currency", {
        //             to: "lightningReceiveConfirmation",
        //             unit,
        //           });
        //         }}
        //         icon={<FixedAmountIcon />}
        //         text={"Fixed Amount"}
        //       />
        //     </View>
        //   </View>
        //   <Button
        //     text={"Paste ecash token"}
        //     variant="primary"
        //     onPress={handleEcashPaste}
        //   ></Button>
        // </>
      }
      children={
        <View>
          {currentProfile?.npub && unit === 'sat' && (
            <PaymentInfo
              data={`${currentProfile?.npub}@npub.cash`}
              popupMessage={'lightning_address_copied'}
              unit="sat"
            />
          )}
        </View>
      }
    />
  );
};

export default EcashLightningReceiver;

const createStyles = (theme) =>
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
