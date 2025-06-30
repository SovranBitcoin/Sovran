import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { shades } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { useNavigation } from 'expo-router';
import lookup from 'country-code-lookup';
import { FlagIcon } from 'assets/icons';
import { getLightningAmount, getMeltQuote } from 'components/cashu';
import { memoizedGetBalance, memoizedGetSelectedMint, setSelectedMint } from 'helper/redux/cashu';
import * as Device from 'expo-device';
import opacity from 'hex-color-opacity';
import { useDispatch, useSelector } from 'react-redux';
import { memoizedGetTheme } from 'helper/redux/settings';
import { useRoute } from '@react-navigation/native';
import { truncateMiddle } from 'helper/strings';
import { showMessage } from 'helper/popup/popups';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { Card } from 'components/common/Card';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { Section } from 'components/common/Section';

export const LNVPN_PUBKEY = '06dde95f0268ce40128bf73ca6e85567b8567688ea52f24dcd5734e77c50f2d9';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);

  const navigation = useNavigation();
  const { params } = useRoute();
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
        });
      }
    } catch {
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
  const handleMintSelected = async (mint: {
    id: string;
    name: string;
    iconUrl: string | null;
    unit: string;
  }) => {
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
              <Text size={14} style={{ color: shades[200], marginTop: 8 }}>
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
      }>
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
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
