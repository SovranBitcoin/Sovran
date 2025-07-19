import React, { useState, useEffect } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import * as Device from 'expo-device';
import lookup from 'country-code-lookup';
import opacity from 'hex-color-opacity';

import { shades } from 'helper/colors';
import Modal from 'components/layout/Modal';
import { Spacer, View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { FlagIcon } from 'assets/icons';
import { getLightningAmount, getMeltQuote } from 'helper/cashuClient';
import { memoizedGetBalance, memoizedGetSelectedMint, setSelectedMint } from 'helper/redux/cashu';
import { showMessage } from 'helper/popup/popups';
import MintBalanceDisplay from 'components/layout/MintBalanceDisplay';
import { Card } from 'components/common/Card';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { Section } from 'components/common/Section';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { useTypedRoute } from 'helper/navigation';

function ModalScreen() {
  const navigation = useNavigation();
  const params = useTypedRoute<'esimCheckout'>();
  const dispatch = useDispatch();

  const [loading, setLoading] = useState(false);
  const [iosWarning, setIosWarning] = useState('');
  const [unit, setUnit] = useState('sat');

  const balance = useSelector(memoizedGetBalance(unit));
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const profileId = useSelector(memoizedGetCurrentProfile)?.id;

  useEffect(() => {
    if (Platform.OS === 'ios') {
      const version = parseFloat(Device.osVersion || '0');
      if (version < 17.4) {
        setIosWarning(
          'Update to your iOS version to 17.4 or above for a better onboarding experience.'
        );
      }
    }
  }, []);

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));
    setUnit(mint.unit);
  };

  const handleBuy = async () => {
    setLoading(true);
    const meltQuoteRes = await getMeltQuote({
      pr: params.request,
      unit: 'sat',
      mintUrl: selectedMint,
    });
    if (meltQuoteRes.isErr()) {
      showMessage('general_error', {}, { emoji: '❌' });
      setLoading(false);
      return;
    }
    const meltQuote = meltQuoteRes.value;

    const amount = getLightningAmount({ pr: params.request });
    const totalAmount = (amount || 0) + meltQuote.fee_reserve;

    if (balance < totalAmount) {
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
        pubkey: '1e53e900c3bbc5ead295215efe27b2c8d5fbd15fb3dd810da3063674cb7213b2',
      });
    }
    setLoading(false);
  };

  const getSectionItems = () => {
    const styles = createStyles();
    const baseItems = [
      {
        title: 'Coverage',
        value: (
          <View style={styles.flagContainer}>
            <FlagIcon width={24} height={24} country={params.location} />
            <Text style={styles.countryText}>{lookup.byIso(params.location).country}</Text>
          </View>
        ),
      },
      {
        title: 'Type',
        value: String(params.type),
      },
      {
        title: 'Data',
        value: `${params.volume / 1073741824} GB`,
      },
      {
        title: 'Validity',
        value: `${params.duration} days`,
      },
      {
        title: 'Speed',
        value: params.speed,
      },
    ];

    // Conditionally add topup information
    if (params?.type === 'TOPUP') {
      baseItems.splice(2, 0, {
        title: 'Topup for',
        value: params?.iccid,
      });
    }

    return baseItems;
  };

  const styles = createStyles();

  return (
    <Modal
      showBack
      title="Checkout"
      buttons={
        <>
          {iosWarning ? (
            <View style={styles.warningContainer}>
              <Text size={14} style={styles.warningText}>
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
                onPress: handleBuy,
              },
            ]}
          />
        </>
      }>
      <Section camera={false} items={getSectionItems()} />
      <Spacer size={12} />

      <Section
        camera={false}
        items={[
          {
            title: 'Total due',
            value: `$${params.price / 10000}`,
          },
        ]}
      />
      <Spacer size={12} />
      <Text weight="bold" size={16} style={styles.sectionTitle}>
        Pay with
      </Text>
      <MintBalanceDisplay onMintSelected={handleMintSelected} unit={unit} />
      <View style={styles.cardContainer}>
        <Card variant="warning" message="Ensure your phone supports eSIMs." />
      </View>
    </Modal>
  );
}

const createStyles = () =>
  StyleSheet.create({
    flagContainer: {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'transparent',
    },
    countryText: {
      marginLeft: 4,
      fontSize: 16,
    },
    sectionTitle: {
      marginLeft: 24,
      fontSize: 16,
      fontFamily: 'OverpassBold',
      marginBottom: 8,
    },
    cardContainer: {
      margin: 16,
    },
    warningContainer: {
      backgroundColor: opacity(shades[200], 0.33),
      borderColor: shades[200],
      margin: 16,
      marginBottom: 8,
      padding: 8,
      borderRadius: 8,
      borderWidth: 0.2,
    },
    warningText: {
      color: shades[200],
      marginTop: 8,
      fontSize: 14,
    },
  });

export default withSheetProvider(ModalScreen);
