import { StyleSheet, Platform } from 'react-native';

import { greys, shades } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Text, View } from 'components/common/Themed';
import { useNavigation } from 'expo-router';
import lookup from 'country-code-lookup';
import { FlagIcon } from 'assets/icons';
import { Section } from './transaction';
import { getLightningAmount, getMeltQuote } from 'components/cashu';
import {
  memoizedGetBalance,
  memoizedGetSelectedMint,
  setSelectedMint,
  useCashu,
} from 'helper/redux/cashu';
import { useState, useEffect } from 'react';
import * as Device from 'expo-device';
import opacity from 'hex-color-opacity';
import { useDispatch, useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useRoute } from '@react-navigation/native';
import { truncateMiddle } from 'helper/strings';
import { showMessage } from 'helper/popup/popups';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import React from 'react';
import { Card } from 'components/common/Card';
import { ButtonHandler } from './ecashSendConfirmation';

export const LNVPN_PUBKEY = '06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);

  const navigation = useNavigation();
  const { params } = useRoute();
  const { proofs, keysets } = useCashu();
  const [unit, setUnit] = useState('sat');
  const [loading, setLoading] = useState(false);
  const [iosWarning, setIosWarning] = useState('');
  const balance = useSelector(memoizedGetBalance(unit));
  const selectedMint = useSelector(memoizedGetSelectedMint);
  async function buyEsim() {
    try {
      const meltQuote = await getMeltQuote({
        pr: params.request,
        unit: 'sat',
        mintUrl: selectedMint,
      });

      const amount = getLightningAmount({ pr: params.request });
      // Alert.alert(String(amount));

      const totalAmount = amount + meltQuote.fee_reserve;
      //
      const isBalanceSufficient = balance >= totalAmount;

      if (!isBalanceSufficient) {
        showMessage(
          'insufficient_balance',
          { amount, unit, fee: meltQuote.fee_reserve },
          { emoji: '🚨' }
        );
      } else {
        navigation.navigate('lightningSendConfirmation', {
          pr: params.request,
          unit,
          meltQuote: JSON.stringify(meltQuote),
          pubkey: LNVPN_PUBKEY,
          redirect: 'vpns',
        });
      }
    } catch (error) {
      showMessage('general_error', {}, { emoji: '❌' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (Platform.OS === 'ios') {
      const version = parseFloat(Device.osVersion);
      if (version < 17.4) {
        setIosWarning(
          'Update to your iOS version to 17.4 or above for a better onboarding experience.'
        );
      }
    }
  }, []);

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
      setUnit(mint.unit);
      // Update account unit
    } catch (error) {
      throw error;
    }
  };

  return (
    <Modal
      showBack
      title={`Checkout`}
      children={
        <>
          <Section
            camera={false}
            items={[
              {
                title: 'Location',
                value: (
                  <View
                    style={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: 'transparent',
                    }}>
                    <FlagIcon width={24} height={24} country={params.location} />
                    <Text
                      style={{
                        marginLeft: 4,
                        fontSize: 16,
                      }}>
                      {lookup.byIso(params.location).country}
                    </Text>
                  </View>
                ),
              },
              {
                title: 'Hash',
                value: truncateMiddle(params.hash, 5),
              },
              {
                title: 'Duration',
                value: params.duration,
              },
              // {
              //   title: "Type",
              //   value: String(params.type),
              // },
              // ...(params?.type === "TOPUP"
              //   ? [
              //       {
              //         title: "Topup for",
              //         value: params?.iccid,
              //       },
              //     ]
              //   : []),
              // {
              //   title: "Data",
              //   value: `${params.volume / 1073741824} GB`,
              // },
              // {
              //   title: "Validity",
              //   value: `${params.duration} days`,
              // },
              // {
              //   title: "Speed",
              //   value: params.speed,
              // },
            ]}
          />
          <Section
            camera={false}
            items={[
              {
                title: 'Total due',
                value: `$${params.price}`,
              },
            ]}
          />
          <Text
            weight="bold"
            size={16}
            style={{
              marginLeft: 24,
              fontSize: 16,
              fontFamily: 'OverpassBold',
              marginBottom: 8,
            }}>
            Pay with
          </Text>
          <SelectedMintDisplay onMintSelected={handleMintSelected} unit={unit} loading={loading} />
          <View style={{ margin: 16 }}>
            <Card
              variant="warning"
              message="VPN services are provided by LNVPN. You need to install WireGuard to
            use the VPN."
              theme={theme}
            />
          </View>
        </>
      }
      buttons={
        <>
          {iosWarning ? (
            <View
              style={{
                backgroundColor: opacity(shades[200], 0.33),
                borderColor: shades[200],
                margin: 16,
                marginBottom: 8,
                padding: 8,
                borderRadius: 8,
                borderWidth: 0.2,
              }}>
              <Text size={14} style={{ color: shades[400], marginTop: 8 }}>
                {iosWarning}
              </Text>
            </View>
          ) : null}
          <ButtonHandler
            buttons={[
              {
                text: 'Buy',
                variant: 'primary',
                loading: loading,
                onPress: async () => {
                  setLoading(true);
                  await buyEsim();
                },
              },
            ]}
          />
        </>
      }
    />
  );
}

export default ModalScreen;

const createStyles = (theme) =>
  StyleSheet.create({
    textInput: {
      backgroundColor: greys(theme)[1800],
      borderWidth: 1,
      borderColor: greys(theme)[1300],
      shadowColor: greys(theme)[2300],
      shadowOffset: { width: 1, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 6,
      borderRadius: 86,
      padding: 8,
      color: greys(theme)[0],
      marginBottom: 8,
      paddingLeft: 16,
      fontFamily: 'OverpassBold',
    },
    minus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#9A4141',
      marginRight: 4,
    },
    plus: {
      fontFamily: 'OverpassBold',
      fontSize: 32,
      color: '#499A41',
      marginRight: 4,
    },
    container: {
      backgroundColor: greys(theme)[2300],
    },
    title: {
      fontSize: 20,
      fontWeight: 'bold',
      color: greys(theme)[1000],
    },
    separator: {
      marginVertical: 30,
      height: 1,
      width: '80%',
    },
  });
