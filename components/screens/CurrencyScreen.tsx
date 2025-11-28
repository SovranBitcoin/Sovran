/**
 * @fileoverview Shared Currency/Amount selection screen component
 *
 * This module provides the core UI and logic for amount selection.
 * Navigation routing is handled by callbacks passed from route wrappers.
 */

import { popup } from '@/helper/popup';
import { getEncodedToken, getEncodedTokenV4, MeltQuoteResponse } from '@cashu/cashu-ts';
import Icon from 'assets/icons';
import { MintHistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import CustomKeyboard from 'components/blocks/CustomKeyboard';
import WalletHeaderTitle from 'components/blocks/WalletHeaderTitle';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { Avatar } from 'components/ui/Avatar';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, View } from 'components/ui/View';
import * as Clipboard from 'expo-clipboard';
import { checkBalance, createWalletFromToken, topUpBalance } from 'helper/routstr/api';
import { useLightningOperations, useManager, useMelt, useSend } from 'hooks/coco';
import { requestInvoiceFromLnurl } from '@/helper/coco/utils';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useTheme } from 'providers/ThemeProvider';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { SheetManager } from 'react-native-actions-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMintStore } from 'stores/mintStore';
import { useRoutstrStore } from 'stores/routstrStore';

export interface CurrencyScreenParams {
  amount?: string;
  unit: string;
  to: string;
  paymentRequest?: string;
  profile?: string;
  lud16?: string;
  allowedUnits?: string;
  mints?: string;
  lnUrlOrAddress?: string;
  routstrTopUp?: string;
}

export interface CurrencyScreenProps {
  params: CurrencyScreenParams;
  onMintQuoteCreated: (mintHistoryEntry: MintHistoryEntry) => void;
  onSendTokenCreated: (sendHistoryEntry: SendHistoryEntry) => void;
  onMeltQuoteCreated: (meltQuote: MeltQuoteResponse) => void;
  onCameraPress: (unit: string) => void;
  onReceiveTokenScanned?: (receiveHistoryEntry: ReceiveHistoryEntry & { token: string }) => void;
  onRoutstrSuccess?: () => void;
  processPaymentStringFn?: (scanning: { data: string; type?: string }) => Promise<void>;
}

export function CurrencyScreen({
  params,
  onMintQuoteCreated,
  onSendTokenCreated,
  onMeltQuoteCreated,
  onCameraPress,
  onRoutstrSuccess,
  processPaymentStringFn,
}: CurrencyScreenProps) {
  const { getPrimaryColor } = useTheme();
  const insets = useSafeAreaInsets();

  const { send } = useSend();
  const { requestLightningInvoice } = useLightningOperations();
  const { createMeltQuote } = useMelt();
  const { apiKey, setApiKey, setBalance } = useRoutstrStore();

  const [amount, setAmount] = useState(params?.amount ? parseFloat(params.amount) : 0);
  const [loading, setLoading] = useState(false);
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const [unit, setUnit] = useState(params?.unit?.toLowerCase() || 'sat');
  const [isValidAmount, setIsValidAmount] = useState(false);

  useEffect(() => {
    setIsValidAmount(amount > 0);
  }, [amount]);

  const manager = useManager();

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    const newUnit = mint.unit.toLowerCase();
    setUnit(newUnit);
  };

  const handleLightningReceive = async ({ memo: _memo }: { memo?: string }) => {
    if (!selectedMint) {
      popup({ message: 'No mint selected', emoji: '🚨', type: 'error' });
      return;
    }

    const mintQuote = await requestLightningInvoice(selectedMint, amount);

    const mintHistoryEntry = await manager.history
      .getPaginatedHistory()
      .then((h) => h.find((h) => h.type === 'mint' && h.quoteId === mintQuote.quote));

    if (mintHistoryEntry) {
      onMintQuoteCreated(mintHistoryEntry as MintHistoryEntry);
    }
  };

  const handleEcashSend = async ({ message: _message }: { message?: string }) => {
    if (!selectedMint) {
      popup({ message: 'No mint selected', emoji: '🚨', type: 'error' });
      return;
    }

    const result = await send(selectedMint, amount);

    // Handle Routstr top-up flow
    if (params.routstrTopUp === 'true') {
      try {
        const encodedToken = getEncodedTokenV4(result);
        let currentApiKey = apiKey;

        if (!currentApiKey) {
          const walletResponse = await createWalletFromToken(encodedToken);
          if (walletResponse) {
            currentApiKey = walletResponse.api_key;
            setApiKey(currentApiKey);
            setBalance(walletResponse.balance);
            popup({
              message: `Wallet created! Balance: ${(walletResponse.balance / 1000).toFixed(0)} sats`,
              emoji: '🎉',
              type: 'success',
            });
            onRoutstrSuccess?.();
            return;
          } else {
            currentApiKey = encodedToken;
            setApiKey(currentApiKey);
            try {
              const balanceData = await checkBalance(currentApiKey);
              if (balanceData.api_key && balanceData.api_key !== currentApiKey) {
                currentApiKey = balanceData.api_key;
                setApiKey(currentApiKey);
              }
              setBalance(balanceData.balance);
              popup({
                message: `Routstr wallet initialized! Balance: ${(balanceData.balance / 1000).toFixed(0)} sats`,
                emoji: '🎉',
                type: 'success',
              });
            } catch (balanceError) {
              console.error('Failed to check balance:', balanceError);
              popup({
                message: 'Routstr wallet initialized! You can now use Routstr AI.',
                emoji: '🎉',
                type: 'success',
              });
            }
            onRoutstrSuccess?.();
            return;
          }
        } else {
          const topUpResult = await topUpBalance(currentApiKey, encodedToken);
          setBalance(topUpResult.new_balance);
          popup({
            message: `Balance topped up! New balance: ${(topUpResult.new_balance / 1000).toFixed(0)} sats`,
            emoji: '🎉',
            type: 'success',
          });
          onRoutstrSuccess?.();
          return;
        }
      } catch (error: any) {
        console.error('Failed to handle Routstr top-up:', error);
        popup({
          message: error.error?.message || 'Failed to process Routstr transaction',
          emoji: '🚨',
          type: 'error',
        });
      }
    }

    const sendHistoryEntry = await manager.history
      .getPaginatedHistory()
      .then((h) =>
        h.find((h) => h.type === 'send' && getEncodedToken(h.token) === getEncodedToken(result))
      );

    if (sendHistoryEntry) {
      onSendTokenCreated(sendHistoryEntry as SendHistoryEntry);
    }
  };

  const handleNext = async () => {
    if (!isValidAmount) return;

    setLoading(true);

    switch (params.to) {
      case 'mintQuote':
        SheetManager.show('transaction-message', {
          onClose: async (data) => {
            if (data?.action && ['confirm', 'skip'].includes(data.action)) {
              await handleLightningReceive({
                memo: data?.action === 'confirm' ? data.message : undefined,
              });
            }
            setLoading(false);
          },
        });
        break;
      case 'sendToken':
        SheetManager.show('transaction-message', {
          onClose: async (data) => {
            await handleEcashSend({
              message: data?.action === 'confirm' ? data.message : undefined,
            });
            setLoading(false);
          },
        });
        break;
      case 'meltQuote':
        if (!params.lnUrlOrAddress) {
          popup({ message: 'No invoice provided', emoji: '🚨', type: 'error' });
          setLoading(false);
          return;
        }

        try {
          if (!selectedMint) {
            popup({ message: 'No mint selected', emoji: '🚨', type: 'error' });
            setLoading(false);
            return;
          }

          const invoice = await requestInvoiceFromLnurl(params.lnUrlOrAddress, amount);

          if (!invoice) {
            popup({ message: 'No invoice provided', emoji: '🚨', type: 'error' });
            setLoading(false);
            return;
          }

          const meltQuote = await createMeltQuote(selectedMint, invoice);
          onMeltQuoteCreated(meltQuote);
        } catch (err) {
          console.error('Failed to create melt quote:', err);
          popup({ message: 'Failed to create melt quote', emoji: '🚨', type: 'error' });
        }

        setLoading(false);
        break;
      default:
        setLoading(false);
        break;
    }
  };

  useEffect(() => {
    if (params?.paymentRequest && params?.amount) {
      setIsValidAmount(true);
    }
  }, [selectedMint, params?.paymentRequest, params?.amount]);

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      popup({ message: 'no_clipboard_address', emoji: '🚨', type: 'error' });
      return;
    }

    if (processPaymentStringFn) {
      await processPaymentStringFn({ data: text });
    }
  };

  const renderButtons = () => {
    const isP2PK = params?.profile && params.to === 'sendToken';
    const isEcashSend = params.to === 'sendToken';
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
              condition: isEcashSend && !isP2PK && !hasPaymentRequest && !!processPaymentStringFn,
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
              onPress: async () => onCameraPress(unit),
              condition: isEcashSend && !isP2PK && !hasPaymentRequest,
            },
          ]}
        />
      </HStack>
    );
  };

  if (!params) return null;

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
        }}>
        <AmountFormatter
          amount={typeof amount === 'string' ? parseFloat(amount) || 0 : amount}
          unit={unit}
          size={48}
          weight="heavy"
          animated
          useTypeColors
          transactionType={
            params?.to === 'sendToken' || params?.to === 'meltQuote' ? 'send' : 'receive'
          }
          centered
        />
        <View style={{ marginVertical: 8 }}>
          <WalletHeaderTitle
            width={280}
            unit={unit}
            requireBalance={params?.to === 'sendToken' || params?.to === 'meltQuote'}
            onMintSelected={handleMintSelected}
          />
        </View>
        {params.to === 'sendToken' && params?.profile && (
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
                <Avatar
                  picture={profile.picture || profile.image}
                  size={28}
                  variant="person"
                  alt={profile.name || 'User Avatar'}
                  name={profile.name}
                />
              ) : (
                <Avatar size={28} variant="person" alt="User Avatar" />
              );
            })()}
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomButtons>
        {!params?.amount && (
          <CustomKeyboard
            loading={loading}
            unit={unit}
            onKeyPress={(value: string) => setAmount(parseFloat(value) || 0)}
          />
        )}
        {renderButtons()}
      </BottomButtons>
    </View>
  );
}
