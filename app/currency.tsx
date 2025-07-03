import React, { useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import Modal from 'components/layout/Modal';
import { NumberInput } from '../components/common/NumberInput';

import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu';
import { getMeltQuote, receiveLightning, sendEcash } from 'components/cashu';
import { useRoute } from '@react-navigation/native';
import CustomKeyboard from 'components/layout/CustomKeyboard';
import { memoizedGetTheme } from 'helper/redux/settings';
import { setSelectedMint } from 'helper/redux/cashu/actions';
import MintBalanceDisplay from 'components/layout/MintBalanceDisplay';
import { sovran } from 'components/layout/sheets/mints';
import { showMessage } from 'helper/popup/popups';

import { View } from 'components/common/View';
import { Text } from 'components/common/Text';
import { barcodeHandler } from 'helper/payment-handler/handlers';
import * as Clipboard from 'expo-clipboard';
import { useTypedNavigation } from 'helper/navigation';
import { SheetManager } from 'react-native-actions-sheet';
import { greys } from 'helper/colors';
import { maybeConvertNpub, npubToPublicKey, pubKeyTo02 } from 'helper/cashu/pay';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Image from 'components/common/Image';
import Icon from 'assets/icons';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { URDecoder } from '@gandlaf21/bc-ur';
import { memoizedGetCurrentProfile } from 'helper/redux/nostr';
import { requestInvoice, utils } from 'lnurl-pay';
interface ScanningData {
  data: string;
  type?: string;
}

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles();
  const dispatch = useDispatch();
  const profileId = useSelector(memoizedGetCurrentProfile).id;
  const { params } = useRoute();
  const navigation = useTypedNavigation();

  const [amount, setAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState(params?.unit?.toLowerCase() || 'sat');
  const [isValidAmount, setIsValidAmount] = useState(false);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const balance = useSelector(memoizedGetBalance(unit, selectedMint));

  // Validate the amount whenever it changes
  useEffect(() => {
    // Amount must be greater than 0 to be valid
    setIsValidAmount(amount > 0);
  }, [amount]);

  const urDecoder = new URDecoder();

  const handleMintSelected = async (mint, balance) => {
    try {
      dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));
      const newUnit = mint.unit.toLowerCase();
      setUnit(newUnit);
      navigation.setParams({ ...params, unit: newUnit });
    } catch (error) {
      showMessage('general_error', {}, { emoji: '🚨' });

      throw error;
    }
  };

  const handleLightningReceive = async ({ memo }) => {
    const response = await receiveLightning({
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      memo,
    });

    navigation?.goBack();
    navigation.replace(params.to, {
      ...params,
      unifiedRequest: response.unifiedRequest,
      paymentRequest: response.paymentRequest,
      request: response.request,
      amount: unit === 'sat' ? amount : amount * 100,
      transaction: JSON.stringify(response),
    });
  };

  const handleEcashSend = async ({ message }) => {
    const transaction = await sendEcash({
      to: npubToPublicKey(params?.profile?.npub),
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      memo: message,
      ...(params?.profile?.pubkey || params?.profile?.npub
        ? {
            p2pk: {
              pubkey:
                pubKeyTo02(params?.profile?.pubkey) || maybeConvertNpub(params?.profile?.npub),
            },
          }
        : {}),
    });

    navigation.replace(params.to, {
      ...params,
      token: transaction.token,
      amount: unit === 'sat' ? amount : amount * 100,
    });
  };

  const handleDefaultSend = async () => {
    const { invoice } = await requestInvoice({
      lnUrlOrAddress: params.lud16,
      tokens: utils.toSats(amount),
    });

    const meltQuote = await getMeltQuote({
      pr: invoice,
      unit: unit,
      mintUrl: selectedMint,
    });

    const totalAmount = Number(amount) + Number(meltQuote.fee_reserve);

    const isBalanceSufficient = unit === 'sat' ? balance >= totalAmount : balance >= totalAmount;

    if (!isBalanceSufficient) {
      showMessage(
        'insufficient_balance',
        { amount, unit, fee: meltQuote.fee_reserve },
        { emoji: '🚨' }
      );
    } else {
      navigation.navigate(params.to, {
        ...params,
        pr: invoice,
        amount: unit === 'sat' ? amount : amount * 100,
        meltQuote: JSON.stringify(meltQuote),
        lud16: params.lud16,
      });
    }
  };

  const handleNext = async () => {
    // Don't proceed if amount is invalid
    if (!isValidAmount) return;

    setLoading(true);

    try {
      switch (params.to) {
        case 'lightningReceiveConfirmation':
          SheetManager.show('transaction-message', {
            onClose: async (data) => {
              if (data?.action === 'confirm') {
                await handleLightningReceive({ memo: data.message });
              } else if (data?.action === 'skip') {
                await handleLightningReceive({ memo: undefined });
              }
              setLoading(false);
            },
          });
          break;
        case 'ecashSendConfirmation':
          // check balance
          if (unit === 'sat' ? balance < amount : balance < amount) {
            showMessage('insufficient_balance', { amount, unit, fee: 0 }, { emoji: '🚨' });
            return;
          }
          SheetManager.show('transaction-message', {
            onClose: async (data) => {
              if (data?.action === 'confirm') {
                await handleEcashSend({ message: data.message });
              } else if (data?.action === 'skip') {
                await handleEcashSend({ message: undefined });
              }
              setLoading(false);
            },
          });
          break;
        default:
          await handleDefaultSend();
          setLoading(false);
          break;
      }
    } catch (e) {
      showMessage(e?.message, { ...e?.params }, { emoji: '🚨' });
      setLoading(false);
    } finally {
    }
  };

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      showMessage('no_clipboard_address', {}, { emoji: '🚨' });
      return;
    }

    const scanning: ScanningData = { data: text };
    setLoading(true);
    await barcodeHandler({
      scanning,
      navigation,
      urDecoder,
      unit,
      selectedMint,
      setLoading,
    });
  };

  const renderButtons = () => {
    const isP2PK = params?.profile && params.to === 'ecashSendConfirmation';
    if (params.to === 'ecashSendConfirmation') {
      return (
        <View style={styles.buttonContainer}>
          <ButtonHandler
            buttons={[
              ...(isP2PK
                ? []
                : [
                    {
                      text: 'Paste',
                      icon: 'lets-icons:copy',
                      variant: 'secondary',
                      onPress: handlePastePress,
                    },
                  ]),
              {
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                loading: loading,
                disabled: !isValidAmount, // Disable the button when amount is invalid
              },
              ...(isP2PK
                ? []
                : [
                    {
                      text: 'Scan QR',
                      icon: 'stash:qr-code',
                      variant: 'secondary',
                      onPress: () => navigation.navigate('camera', { unit }),
                    },
                    {
                      text: 'Contacts',
                      icon: 'mdi:contact',
                      variant: 'secondary',
                      onPress: () => navigation.navigate('contacts'),
                    },
                  ]),
            ]}
          />
        </View>
      );
    }

    return (
      <View style={styles.buttonContainer}>
        <ButtonHandler
          buttons={[
            {
              text: 'Next',
              variant: 'primary',
              loading: loading,
              onPress: handleNext,
              disabled: !isValidAmount, // Disable the button when amount is invalid
            },
          ]}
        />
      </View>
    );
  };
  if (!params) return null;

  return (
    <Modal
      showBack
      title="Select Amount"
      buttons={
        <>
          <CustomKeyboard loading={loading} unit={unit} onKeyPress={setAmount} />
          {renderButtons()}
        </>
      }>
      <NumberInput
        currency={unit}
        value={amount}
        type={
          params?.to === 'ecashSendConfirmation' || params?.to === 'lightningSendConfirmation'
            ? 'send'
            : 'receive'
        }
        onChange={setAmount}
      />
      <MintBalanceDisplay
        onMintSelected={handleMintSelected}
        unit={unit}
        requireBalance={
          params?.to === 'ecashSendConfirmation' || params?.to === 'lightningSendConfirmation'
        }
      />
      {params.to === 'ecashSendConfirmation' && params?.profile && (
        <TouchableOpacity style={[sovran(theme).listItem, { alignSelf: 'center' }]}>
          <Icon
            name="solar:key-bold"
            size={16}
            style={{
              backgroundColor: greys(theme)[500],
              borderRadius: 100,
              padding: 8,
            }}
          />
          <Text>{'  →  '}</Text>
          {params?.profile?.picture || params?.profile?.image ? (
            <Image
              style={{
                width: 28,
                height: 28,
                borderRadius: 1000,
              }}
              source={{ uri: params.profile?.picture || params.profile?.image }}
            />
          ) : (
            <View />
          )}
        </TouchableOpacity>
      )}
    </Modal>
  );
}

const createStyles = () =>
  StyleSheet.create({
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
      paddingBottom: 8,
    },
  });

export default withSheetProvider(ModalScreen);
