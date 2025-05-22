import React from 'react';
import { useState, useEffect } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import Modal from 'components/layout/Modal';
import { NumberInput } from '../components/common/NumberInput';
import { getInvoiceFromLnurl } from 'helper/third-party/lnurl';
import { memoizedGetBalance, memoizedGetSelectedMint } from 'helper/redux/cashu';
import {
  getMeltQuote,
  isValidLNURL,
  receiveLightning,
  sendEcash,
} from 'components/cashu';
import { useNostr } from 'helper/redux/nostr';
import { finalizeEvent, nip04, nip19, SimplePool } from 'nostr-tools';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { useRoute } from '@react-navigation/native';
import CustomKeyboard from 'components/layout/CustomKeyboard';
import { memoizedGetTheme } from 'helper/redux/settings';
import { setSelectedMint } from 'helper/redux/cashu/actions';
import SelectedMintDisplay, { sovran } from 'components/layout/sheets/mints';
import { showMessage } from 'helper/popup/popups';

import { View, Text } from 'components/common/Themed';
import { isValidPaymentRequest } from 'helper/cashu/helper';
import { barcodeHandler, handlePaymentRequest } from 'helper/payment-handler/handlers';
import * as Clipboard from 'expo-clipboard';
import { useTypedNavigation } from 'helper/navigation';
import { SheetManager, SheetProvider } from 'react-native-actions-sheet';
import { SafeAreaView } from 'react-native-safe-area-context';
import { greys } from 'helper/colors';
import { maybeConvertNpub } from 'helper/cashu/pay';
import { TouchableOpacity } from 'components/common/TouchableOpacity';
import Image from 'components/common/Image';
import Icon from 'assets/icons';
import { ButtonHandler } from 'components/common/ButtonHandler';
import { runWithAnimationFrame } from './onboard/new';
import { withSheetProvider } from 'components/hocs/withSheetProvider';
import { URDecoder } from '@gandlaf21/bc-ur';

interface ScanningData {
  data: string;
  type?: string;
}

async function sendDM(priv: string, pub: string, toPubkey: string, message: string, relays: string[]) {
  const encryptMessage = async (privKey: string, recipientPubKey: string, msg: string) => {
    return nip04.encrypt(privKey, recipientPubKey, msg);
  };

  const signEventAsync = async (privKey: string, event: any) => {
    return finalizeEvent(event, hexToBytes(privKey));
  };

  const content = await encryptMessage(priv, toPubkey, message);
  const event = {
    kind: 4,
    tags: [['p', toPubkey]],
    content,
    pubkey: pub,
    created_at: Math.floor(Date.now() / 1000),
    id: '',
    sig: '',
  };

  const signedEvent = await signEventAsync(priv, event);
  return new Promise((resolve, reject) => {
    const pool = new SimplePool();
    const pubs = pool.publish(relays, signedEvent);

    Promise.any(pubs)
      .then(() => resolve(signedEvent))
      .catch((error) => reject(`Failed to publish: ${error}`))
      .finally(() => pool.close(relays));
  });
}

function ModalScreen() {
  const theme = useSelector(memoizedGetTheme);
  const styles = createStyles(theme);
  const dispatch = useDispatch();
  const profileId = useSelector((state) => state.nostr?.currentProfile?.id);
  const { currentProfile } = useNostr();
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
    console.log('[handleEcashSend]', unit === 'sat' ? amount : amount * 100, unit, message, params);
    const transaction = await sendEcash({
      to: params?.profile?.npub,
      amount: unit === 'sat' ? amount : amount * 100,
      unit: unit,
      memo: message,
      ...(params?.profile?.npub
        ? {
            p2pk: {
              pubkey: maybeConvertNpub(params?.profile?.npub),
            },
          }
        : {}),
    });

    if (params?.profile?.npub) {
      try {
        const { data: privKeyBytes } = nip19.decode(currentProfile.nsec);
        const privKeyHex = bytesToHex(privKeyBytes as Uint8Array);
        const { data: recipientHex } = nip19.decode(params.profile.npub);
        const recipient = bytesToHex(recipientHex as Uint8Array);
        const relays = [
          'wss://relay1.nostrchat.io',
          'wss://relay2.nostrchat.io',
          'wss://relay.damus.io',
          'wss://relay.snort.social',
          'wss://nos.lol',
          'wss://purplepag.es',
          'wss://relay.primal.net',
          'wss://nostr.thank.eu',
          'wss://relay.vanderwarker.family',
          'wss://nostr-relay.bitcoin.ninja',
          'wss://lnbits.btc-payserver.eu/nostrrelay/1',
          'wss://nostr.girino.org',
        ];
        await sendDM(privKeyHex, currentProfile.pubkey, recipient, transaction.token, relays);
      } catch (e) {
        console.error('Failed to send token DM', e);
      }
    }

    navigation.replace(params.to, {
      ...params,
      token: transaction.token,
      amount: unit === 'sat' ? amount : amount * 100,
    });
  };

  const handleDefaultSend = async () => {
    console.log('[handleDefaultSend]');
    const { pr } = await getInvoiceFromLnurl(params.lud16, unit === 'sat' ? amount : amount * 100);
    console.log('[handleDefaultSend] pr', pr);

    const meltQuote = await getMeltQuote({
      pr: pr,
      unit: unit,
      mintUrl: selectedMint,
    });
    console.log('[handleDefaultSend] meltQuote', meltQuote);

    const totalAmount = Number(amount) + Number(meltQuote.fee_reserve);
    console.log('[handleDefaultSend] totalAmount', totalAmount);

    const isBalanceSufficient = unit === 'sat' ? balance >= totalAmount : balance >= totalAmount;
    console.log(
      '[handleDefaultSend] isBalanceSufficient',
      balance,
      totalAmount,
      isBalanceSufficient
    );

    if (!isBalanceSufficient) {
      showMessage(
        'insufficient_balance',
        { amount, unit, fee: meltQuote.fee_reserve },
        { emoji: '🚨' }
      );
    } else {
      console.log(
        '[handleDefaultSend] navigate',
        params.to,
        pr,
        unit === 'sat' ? amount : amount * 100,
        meltQuote
      );
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
          console.log('[handleNext] balance passed', balance, amount, unit);
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
      error = true;
      setLoading(false);
    } finally {
    }
  };

  const [urDecoder, setUrDecoder] = useState<URDecoder>(new URDecoder());
  const [progress, setProgress] = useState<number>(0);
  const [scanned, setScanned] = useState<boolean>(false);

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      showMessage('no_clipboard_address', {}, { emoji: '🚨' });
      return;
    }

    if (!isValidLNURL(text)) {
      showMessage('invalid_address', { address: text }, { emoji: '🚨' });
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
      setProgress,
      setLoading,
      setScanned,
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

  return (
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
          <SelectedMintDisplay onMintSelected={handleMintSelected} unit={unit} loading={loading} />
          {params.to === 'ecashSendConfirmation' && params?.profile && (
            <TouchableOpacity style={[sovran(theme).listItem, { alignSelf: 'center' }]}>
              <Icon
                name="solar:key-bold"
                size={16}
                style={{
                  backgroundColor: greys(theme)[1200],
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
        </>
      }
      buttons={
        <>
          <CustomKeyboard loading={loading} unit={unit} onKeyPress={setAmount} />
          {renderButtons()}
        </>
      }
    />
    // <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} />
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

export default withSheetProvider(ModalScreen);
