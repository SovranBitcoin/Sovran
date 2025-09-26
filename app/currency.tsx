import React, { useState, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import Modal from 'components/layout/Modal';
import { NumberInput } from '../components/common/NumberInput';

import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu';
import {
  getMeltQuote,
  receiveLightning,
  sendEcash,
  maybeConvertNpub,
  npubToPublicKey,
  pubKeyTo02,
} from 'helper/cashuClient';
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
import { useTypedNavigation, useTypedRoute } from 'helper/navigation';
import { SheetManager } from 'react-native-actions-sheet';
import { greys } from 'helper/colors';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Image from 'components/common/Image';
import Icon from 'assets/icons';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
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
  const params = useTypedRoute<'currency'>();
  const navigation = useTypedNavigation();

  const [amount, setAmount] = useState(params?.amount || 0);
  const [loading, setLoading] = useState(false);
  const [unit, setUnit] = useState(params?.unit?.toLowerCase() || 'sat');
  const [isValidAmount, setIsValidAmount] = useState(false);
  // const [isValidMint, setIsValidMint] = useState(false);

  const selectedMint = useSelector(memoizedGetSelectedMint);
  const balance = useSelector(memoizedGetBalance(unit, selectedMint));

  // Validate the amount whenever it changes
  useEffect(() => {
    setIsValidAmount(amount > 0);
  }, [amount]);

  const urDecoder = new URDecoder();

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    dispatch(setSelectedMint({ profileId, mintUrl: mint.id }));
    const newUnit = mint.unit.toLowerCase();
    setUnit(newUnit);
    navigation.setParams({ ...params, unit: newUnit });
  };

  const handleLightningReceive = async ({ memo }: { memo?: string }) => {
    const res = await receiveLightning({
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      memo,
    });
    if (res.isOk()) {
      const response = res.value;
      navigation?.goBack();
      navigation.replace(params.to, {
        ...params,
        unifiedRequest: response.unifiedRequest,
        paymentRequest: response.paymentRequest,
        request: response.request,
        amount: unit === 'sat' ? amount : amount * 100,
        transaction: JSON.stringify(response),
      });
    } else {
      showMessage(res.error.message, {}, { emoji: '🚨' });
    }
  };

  const handleEcashSend = async ({ message }: { message?: string }) => {
    const result = await sendEcash({
      to: npubToPublicKey(params?.profile?.npub),
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      memo: message,
      paymentRequest: params.paymentRequest,
      ...(params?.profile?.pubkey || params?.profile?.npub
        ? {
            p2pk: {
              pubkey:
                pubKeyTo02(params?.profile?.pubkey) || maybeConvertNpub(params?.profile?.npub),
            },
          }
        : {}),
    });

    if (result.isOk()) {
      const transaction = result.value;
      navigation.replace(params.to, {
        ...params,
        token: transaction.token,
        amount: unit === 'sat' ? amount : amount * 100,
        paymentRequest: params.paymentRequest,
      });
    } else {
      console.log(1298372, {
        result,
        error: result.error,
        message: result.error.message,
        cause: result.error.cause,
        name: result.error.name,
        stack: result.error.stack,
      });
      showMessage(result.error.message, {}, { emoji: '🚨' });
    }
  };

  const handleDefaultSend = async () => {
    const { invoice } = await requestInvoice({
      lnUrlOrAddress: params.lud16,
      tokens: utils.toSats(amount),
    });

    const meltQuoteRes = await getMeltQuote({
      pr: invoice,
      unit: unit,
      mintUrl: selectedMint,
    });
    if (meltQuoteRes.isErr()) {
      showMessage(meltQuoteRes.error.message, {}, { emoji: '🚨' });
      return;
    }
    const meltQuote = meltQuoteRes.value;

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
        if (unit === 'sat' ? balance < amount : balance < amount * 100) {
          showMessage(
            'insufficient_balance',
            { amount: unit === 'sat' ? amount : amount * 100, unit, fee: 0 },
            { emoji: '🚨' }
          );
          setLoading(false);
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
  };

  useEffect(() => {
    if (params?.paymentRequest && params?.amount) {
      setIsValidAmount(true);
      // setIsValidMint(!!selectedMint);
      // handleNext();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMint]);

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      showMessage('no_clipboard_address', {}, { emoji: '🚨' });
      return;
    }

    const scanning: ScanningData = { data: text };
    setLoading(true);
    const res = await barcodeHandler({
      scanning,
      navigation,
      urDecoder,
      unit,
      selectedMint,
      setLoading,
      balance,
    });
    if (res.isErr()) {
      showMessage(res.error.message || 'An error occurred', {}, { emoji: '🚨' });
    }
  };

  const renderButtons = () => {
    const isP2PK = params?.profile && params.to === 'ecashSendConfirmation';
    const isEcashSend = params.to === 'ecashSendConfirmation';
    const hasPaymentRequest = params?.paymentRequest;

    return (
      <View style={styles.buttonContainer}>
        {!params?.amount && isEcashSend && !hasPaymentRequest && <Text></Text>}
        <ButtonHandler
          buttons={[
            {
              text: 'Paste',
              icon: 'lets-icons:copy',
              variant: 'secondary',
              onPress: handlePastePress,
              condition: isEcashSend && !isP2PK && !hasPaymentRequest,
            },
            {
              text: 'Next',
              ...(isEcashSend && { icon: 'lucide:arrow-right' }),
              variant: 'primary',
              onPress: handleNext,
              loading: loading,
              disabled: hasPaymentRequest
                ? !(
                    isValidAmount &&
                    params?.mints?.includes(selectedMint) &&
                    params?.allowedUnits?.includes(unit.toUpperCase())
                  )
                : !isValidAmount,
            },
            {
              text: 'Scan QR',
              icon: 'stash:qr-code',
              variant: 'secondary',
              onPress: () => navigation.navigate('camera', { unit }),
              condition: isEcashSend && !isP2PK && !hasPaymentRequest,
            },
            {
              text: 'Contacts',
              icon: 'mdi:contact',
              variant: 'secondary',
              onPress: () => navigation.navigate('contacts'),
              condition: isEcashSend && !isP2PK && !hasPaymentRequest,
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
          {!params?.amount && (
            <CustomKeyboard loading={loading} unit={unit} onKeyPress={setAmount} />
          )}
          {renderButtons()}
        </>
      }>
      <NumberInput
        unit={unit}
        value={amount}
        type={
          params?.to === 'ecashSendConfirmation' || params?.to === 'lightningSendConfirmation'
            ? 'send'
            : 'receive'
        }
        onChange={params?.amount ? undefined : setAmount}
      />
      <MintBalanceDisplay
        onMintSelected={handleMintSelected}
        unit={unit}
        allowedMints={params?.mints}
        allowedUnits={params?.allowedUnits}
        requireBalance={
          params?.to === 'ecashSendConfirmation' || params?.to === 'lightningSendConfirmation'
        }
        requireValidMint={!!params?.allowedUnits}
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
