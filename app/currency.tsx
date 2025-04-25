import React from 'react';
import { useState, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import Modal from 'components/layout/Modal';
import { NumberInput } from '../components/common/NumberInput';
import { getInvoiceFromLnurl } from 'helper/third-party/lnurl';
import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu';
import { getMeltQuote, isValidLNURL, receiveLightning, sendEcash } from 'components/cashu';
import { useRoute } from '@react-navigation/native';
import CustomKeyboard from 'components/layout/CustomKeyboard';
import { memoizedGetTheme } from 'helper/redux/settings';
import { setSelectedMint } from 'helper/redux/cashu/actions';
import SelectedMintDisplay from 'components/layout/sheets/mints';
import { showMessage } from 'helper/popup/popups';
import { ButtonHandler } from './ecashSendConfirmation';
import { View } from 'components/common/Themed';
import { isValidPaymentRequest } from 'helper/cashu/helper';
import { handlePaymentRequest } from 'helper/payment-handler/handlers';
import * as Clipboard from 'expo-clipboard';
import { useTypedNavigation } from 'helper/navigation';
import { SheetManager } from 'react-native-actions-sheet';

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const dispatch = useDispatch();
  const profileId = useSelector((state) => state.nostr?.currentProfile?.id);
  const { params } = useRoute();
  const navigation = useTypedNavigation();

  if (!params) return null;

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

  const handleLightningReceive = async () => {
    const response = await receiveLightning({
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
    });

    navigation.goBack();
    navigation.goBack();
    navigation.navigate(params.to, {
      ...params,
      unified_request: response.unified_request,
      payment_request: response.payment_request,
      request: response.request,
      amount: unit === 'sat' ? amount : amount * 100,
      transaction: JSON.stringify(response),
    });
  };

  const handleEcashSend = async ({ message }) => {
    const token = await sendEcash({
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      note: message,
    });

    navigation.goBack();
    navigation.goBack();
    navigation.navigate(params.to, {
      ...params,
      token,
      amount: unit === 'sat' ? amount : amount * 100,
    });
  };

  const handleDefaultSend = async () => {
    const { pr } = await getInvoiceFromLnurl(params.lud16, unit === 'sat' ? amount : amount * 100);

    const meltQuote = await getMeltQuote({
      pr: pr,
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
        pr,
        amount: unit === 'sat' ? amount : amount * 100,
        meltQuote: JSON.stringify(meltQuote),
      });
    }
  };

  const handleNext = async () => {
    // Don't proceed if amount is invalid
    if (!isValidAmount) return;

    let error = false;
    setLoading(true);

    try {
      switch (params.to) {
        case 'lightningReceiveConfirmation':
          await handleLightningReceive();
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
            },
          });
          break;
        default:
          await handleDefaultSend();
          break;
      }
    } catch (e) {
      showMessage(e?.message, { ...e?.params }, { emoji: '🚨' });
      error = true;
    } finally {
      setLoading(false);
    }
  };

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();

    if (isValidPaymentRequest(text)) {
      await handlePaymentRequest({ request: text, navigation });
      return;
    }

    if (!text) {
      showMessage('no_clipboard_address', {}, { emoji: '🚨' });
      return;
    }

    if (!isValidLNURL(text)) {
      showMessage('invalid_address', { address: text }, { emoji: '🚨' });
      return;
    }

    // This is kept to maintain the original logic but appears to be incomplete in the original
    throw new Error('Function not implemented.');
  };

  const renderButtons = () => {
    if (params.to === 'ecashSendConfirmation') {
      return (
        <View style={styles.buttonContainer}>
          <ButtonHandler
            buttons={[
              {
                text: 'Paste',
                icon: 'lets-icons:copy',
                variant: 'secondary',
                onPress: handlePastePress,
              },
              {
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: handleNext,
                disabled: !isValidAmount, // Disable the button when amount is invalid
              },
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

  return (
    <>
      <Modal
        showBack
        title="Select Amount"
        children={
          <>
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
            <SelectedMintDisplay
              onMintSelected={handleMintSelected}
              unit={unit}
              loading={loading}
            />
          </>
        }
        buttons={
          <>
            <CustomKeyboard loading={loading} unit={unit} onKeyPress={setAmount} />
            {renderButtons()}
          </>
        }
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} />
    </>
  );
}

const createStyles = (theme) =>
  StyleSheet.create({
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'transparent',
      paddingBottom: 8,
    },
  });

export default ModalScreen;
