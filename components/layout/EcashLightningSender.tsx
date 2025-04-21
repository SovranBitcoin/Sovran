import React from 'react';
import 'react-native-get-random-values';
import { KeyboardAvoidingView } from 'react-native';

import { GeneralizedBlurInput, View } from 'components/common/Themed';
import { useState } from 'react';
import { getMeltQuote, isValidLNURL } from 'components/cashu';

import { useNavigation } from 'expo-router';
import { Button } from 'components/common/Button';
import Modal from 'components/layout/Modal';
import { EcashIcon, QRCodeIcon } from 'assets/icons';
import { memoizedGetBalance, memoizedGetSelectedMint, setSelectedMint } from 'helper/redux/cashu';
import * as Clipboard from 'expo-clipboard';

import { PermissionsButton } from 'components/common/Permissions';
import { greys, shades } from 'helper/colors';
import { useCameraPermissions } from 'expo-camera';
import opacity from 'hex-color-opacity';
import { useDispatch, useSelector } from 'react-redux';

import { URL } from 'url';
import { memoizedGetTheme } from 'helper/redux/settings';
import { isValidPaymentRequest } from 'helper/cashu/helper';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { showMessage } from 'helper/popup/popups';
import { handlePaymentRequest } from 'helper/payment-handler/handlers';

function mintDisplayText(mint) {
  // https://mint.minibits.cash/Bitcoin -> mint.minibits.cash
  const url = new URL(mint);
  return `${url.protocol}//${url.hostname}`;
}

export default function EcashLightningSender({ type, ...params }) {
  const theme = useSelector(memoizedGetTheme);

  const navigation = useNavigation();
  const [unit, setUnit] = useState(params?.unit || 'sat');

  const [hasPermission, requestPermission] = useCameraPermissions();

  const handleInputPress = () => {
    navigation.navigate('contacts', { unit });
  };

  const handleLightningUrl = async ({ lightningUrl }) => {
    const meltQuote = await getMeltQuote({
      pr: lightningUrl,
      unit,
      mintUrl: selectedMint,
    });

    navigation.navigate('lightningSendConfirmation', {
      pr: lightningUrl,
      unit,
      meltQuote: JSON.stringify(meltQuote),
    });
  };

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();

    if (isValidPaymentRequest(text)) {
      await handlePaymentRequest({ request: text, navigation });
    }

    if (!isValidLNURL(text)) {
      if (text) {
        showMessage('invalid_address', { address: text }, { emoji: '🚨' });
        return;
      } else {
        showMessage('no_clipboard_address', {}, { emoji: '🚨' });
        return;
      }
    }

    if (text && isValidLNURL(text)) {
      await handleLightningUrl({ lightningUrl: text });
    }
  };

  const balance = useSelector(memoizedGetBalance(unit));
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const profileId = useSelector((state: any) => state.nostr?.currentProfile?.id);

  const dispatch = useDispatch();
  const handleMintSelected = async (
    mint: {
      id: string;
      name: string;
      iconUrl: string | null;
      unit: string;
    },
    balance: { amount: number; unit: string } | undefined
  ) => {
    try {
      // Update selected mint in Redux
      dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));

      // Update the unit
      setUnit(mint.unit);
      // Update navigation params
      navigation.setParams({ ...params, unit: mint.unit });
    } catch (error) {
      showMessage('mint_update_failed', {}, { emoji: '🚨' });

      throw error;
    }
  };

  return (
    <>
      <Modal
        showClose
        transparent={true}
        title={`Send ${unit === 'sat' ? 'Bitcoin' : unit.toUpperCase()}`}
        children={
          <SelectedMintDisplay onMintSelected={handleMintSelected} unit={unit} loading={false} />
        }
        buttons={
          <>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                marginTop: 8,
                backgroundColor: 'transparent',
              }}>
              <View
                style={{
                  flex: hasPermission?.granted ? 1 : 0,
                  backgroundColor: 'transparent',
                }}>
                {hasPermission?.granted ? (
                  <Button
                    variant={'secondary'}
                    icon={<QRCodeIcon />}
                    text={'Scan QR'}
                    onPress={() =>
                      navigation.navigate('camera', {
                        unit,
                      })
                    }
                    position="left"
                  />
                ) : (
                  <PermissionsButton
                    description={`There was a problem accessing your camera. Please check the App permissions and try again.`}
                    icon={<QRCodeIcon />}
                    text="Scan QR"
                    position="left"
                  />
                )}
              </View>

              <View
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                }}>
                <Button
                  variant={'secondary'}
                  position={hasPermission?.granted ? 'right' : 'right'}
                  onPress={() => {
                    navigation.navigate('currency', {
                      to: 'ecashSendConfirmation',
                      unit,
                      type,
                    });
                  }}
                  icon={<EcashIcon />}
                  text={'Create Ecash'}
                />
              </View>
            </View>
            <GeneralizedBlurInput
              onPress={handleInputPress}
              placeholder="Send to contact"
              padding={30}
              onButtonPress={handlePastePress}
              buttonColor={shades[100]}
              borderColor={greys(theme)[1300]}
              shadowColor={greys(theme)[2300]}
              backgroundColor={opacity(greys(theme)[1800], 0.75)}
              textColor={greys(theme)[1000]}
            />
          </>
        }
      />
      <KeyboardAvoidingView behavior={'padding'}>
        <View
          style={{
            height: 32,
          }}></View>
      </KeyboardAvoidingView>
    </>
  );
}
