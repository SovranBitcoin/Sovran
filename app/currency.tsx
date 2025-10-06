import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Modal from 'components/blocks/Modal';
import { AmountFormatter } from '../components/ui/AmountFormatter';

import { useMintManagement, useCashuOperations, useLightningOperations } from 'hooks/coco';
import CustomKeyboard from 'components/blocks/CustomKeyboard';
import { useTheme } from 'providers/ThemeProvider';
// Removed Redux Cashu import - now using Coco
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { showMessage } from 'helper/popup/popups';
import type { MintHistoryEntry, MeltHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';

import { View, HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import { barcodeHandler } from 'helper/payment-handler/handlers';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, router } from 'expo-router';
import { SheetManager } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import Image from 'components/ui/Image';
import Icon from 'assets/icons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { URDecoder } from '@gandlaf21/bc-ur';
// Removed memoizedGetCurrentProfile - no longer needed
import { requestInvoice, utils } from 'lnurl-pay';
import { memoizedGetSelectedMint } from 'helper/redux/cashu';
interface ScanningData {
  data: string;
  type?: string;
}

function ModalScreen() {
  const { getPrimaryColor } = useTheme();
  const params = useLocalSearchParams<{
    amount?: string;
    unit: string;
    to: string;
    paymentRequest?: string;
    profile?: string;
    lud16?: string;
    allowedUnits?: string;
    mints?: string;
  }>();

  // Use Coco hooks instead of Redux
  const { getBalances } = useMintManagement();
  const { sendEcash } = useCashuOperations();
  const { payLightningInvoice, requestLightningInvoice } = useLightningOperations();

  const [amount, setAmount] = useState(params?.amount ? parseFloat(params.amount) : 0);
  const [loading, setLoading] = useState(false);
  const selectedMint = useSelector(memoizedGetSelectedMint);
  const [balance, setBalance] = useState(0);
  const [unit, setUnit] = useState(params?.unit?.toLowerCase() || 'sat');
  const [isValidAmount, setIsValidAmount] = useState(false);
  // const [isValidMint, setIsValidMint] = useState(false);

  // Load balance and selected mint from Coco
  useEffect(() => {
    const loadData = async () => {
      try {
        const balances = await getBalances();
        // For now, use the first available mint or a default
        const mintUrl = Object.keys(balances)[0];
        setBalance(balances[mintUrl] || 0);
      } catch (error) {
        console.error('Failed to load balance:', error);
      }
    };
    loadData();
  }, [getBalances]);

  // Validate the amount whenever it changes
  useEffect(() => {
    setIsValidAmount(amount > 0);
  }, [amount]);

  const urDecoder = new URDecoder();

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    // Note: setSelectedMintState is not defined in this component
    // This might need to be implemented based on your state management
    const newUnit = mint.unit.toLowerCase();
    setUnit(newUnit);
    // Note: navigation.setParams is not available in this context
    // The unit change will be handled by the parent component
  };

  const handleLightningReceive = async ({ memo: _memo }: { memo?: string }) => {
    try {
      const quote = await requestLightningInvoice(
        selectedMint || 'https://mint.minibits.cash/Bitcoin', // Fallback mint URL
        unit === 'sat' ? amount : amount * 100
      );

      // Create a mint history entry for Lightning receive
      const mintHistoryEntry: MintHistoryEntry = {
        id: `mint-${Date.now()}`,
        type: 'mint',
        amount: unit === 'sat' ? amount : amount * 100,
        unit: unit,
        mintUrl: selectedMint || 'https://mint.minibits.cash/Bitcoin',
        createdAt: Date.now(),
        state: 'UNPAID',
        paymentRequest: quote.request,
        quoteId: quote.quote,
        metadata: {
          memo: _memo || '',
        },
      };

      router.back();
      router.replace({
        pathname: `/${params.to}` as any,
        params: {
          mintHistoryEntry: JSON.stringify(mintHistoryEntry),
        },
      });
    } catch (error) {
      console.error('Failed to create Lightning invoice:', error);
      showMessage(error instanceof Error ? error.message : 'Unknown error', {}, { emoji: '🚨' });
    }
  };

  const handleEcashSend = async ({ message: _message }: { message?: string }) => {
    try {
      // Use Coco's ecash operations
      const result = await sendEcash(
        selectedMint || 'https://mint.minibits.cash',
        unit === 'sat' ? amount : amount * 100
      );

      // Create a send history entry for ecash send
      const sendHistoryEntry: SendHistoryEntry = {
        id: `send-${Date.now()}`,
        type: 'send',
        amount: unit === 'sat' ? amount : amount * 100,
        unit: unit,
        mintUrl: selectedMint || 'https://mint.minibits.cash',
        createdAt: Date.now(),
        token: result,
        metadata: {
          memo: _message || '',
        },
      };

      router.replace({
        pathname: `/${params.to}` as any,
        params: {
          sendHistoryEntry: JSON.stringify(sendHistoryEntry),
        },
      });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unknown error', {}, { emoji: '🚨' });
    }
  };

  const handleDefaultSend = async () => {
    if (!params.lud16) {
      showMessage('No Lightning address provided', {}, { emoji: '🚨' });
      return;
    }

    const { invoice } = await requestInvoice({
      lnUrlOrAddress: params.lud16,
      tokens: utils.toSats(amount),
    });

    try {
      // Use Coco's Lightning operations
      const meltQuote = await payLightningInvoice(
        selectedMint || 'https://mint.minibits.cash',
        invoice
      );

      const totalAmount = Number(amount) + Number(meltQuote.fee_reserve || 0);

      const isBalanceSufficient = unit === 'sat' ? balance >= totalAmount : balance >= totalAmount;

      if (!isBalanceSufficient) {
        showMessage(
          'insufficient_balance',
          { amount, unit, fee: meltQuote.fee_reserve || 0 },
          { emoji: '🚨' }
        );
        return;
      }

      // Create a melt history entry for Lightning send
      const meltHistoryEntry: MeltHistoryEntry = {
        id: `melt-${Date.now()}`,
        type: 'melt',
        amount: unit === 'sat' ? amount : amount * 100,
        unit: unit,
        mintUrl: selectedMint || 'https://mint.minibits.cash',
        createdAt: Date.now(),
        state: 'UNPAID',
        quoteId: meltQuote.quote,
        metadata: {},
      };

      router.push({
        pathname: `/${params.to}` as any,
        params: {
          meltHistoryEntry: JSON.stringify(meltHistoryEntry),
        },
      });
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Unknown error', {}, { emoji: '🚨' });
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
      <HStack className={'pb-2'} justify="center" align="center">
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
                    (params?.mints as unknown as string[])?.includes(selectedMint || '') &&
                    (params?.allowedUnits as unknown as string[])?.includes(
                      unit.toUpperCase() || ''
                    )
                  )
                : !isValidAmount,
            },
            {
              text: 'Scan QR',
              icon: 'stash:qr-code',
              variant: 'secondary',
              onPress: async () =>
                router.push({
                  pathname: '/camera',
                  params: { unit },
                }),
              condition: isEcashSend && !isP2PK && !hasPaymentRequest,
            },
            {
              text: 'Contacts',
              icon: 'mdi:contact',
              variant: 'secondary',
              onPress: async () => router.push('/contacts'),
              condition: isEcashSend && !isP2PK && !hasPaymentRequest,
            },
          ]}
        />
      </HStack>
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
            <CustomKeyboard
              loading={loading}
              unit={unit}
              onKeyPress={(value: string) => setAmount(parseFloat(value) || 0)}
            />
          )}
          {renderButtons()}
        </>
      }>
      <AmountFormatter
        amount={typeof amount === 'string' ? parseFloat(amount) || 0 : amount}
        unit={unit}
        size={48}
        weight="heavy"
        animated
        useTypeColors
        transactionType={
          params?.to === 'ecashSendConfirmation' || params?.to === 'lightningSendConfirmation'
            ? 'send'
            : 'receive'
        }
        centered
      />
      <MintBalanceDisplay
        onMintSelected={handleMintSelected}
        unit={unit}
        allowedMints={params?.mints as unknown as string[]}
        allowedUnits={params?.allowedUnits as unknown as string[]}
        requireBalance={
          params?.to === 'ecashSendConfirmation' || params?.to === 'lightningSendConfirmation'
        }
        requireValidMint={!!params?.allowedUnits}
      />
      {params.to === 'ecashSendConfirmation' && params?.profile && (
        <TouchableOpacity
          style={[
            {
              padding: 8,
              borderRadius: 16,
              borderWidth: 0.2,
              borderColor: getPrimaryColor('600'),
              marginVertical: 4,
              alignSelf: 'center',
            },
          ]}>
          <Icon
            name="solar:key-bold"
            size={16}
            style={{
              backgroundColor: getPrimaryColor('500'),
              borderRadius: 100,
              padding: 8,
            }}
          />
          <Text>{'  →  '}</Text>
          {(() => {
            const profile = params?.profile ? JSON.parse(params.profile) : null;
            return profile?.picture || profile?.image ? (
              <Image
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 1000,
                }}
                source={{ uri: profile.picture || profile.image }}
              />
            ) : (
              <View />
            );
          })()}
        </TouchableOpacity>
      )}
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
