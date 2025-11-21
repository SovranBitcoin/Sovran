import React, { useState, useEffect } from 'react';
import Modal from 'components/blocks/Modal';
import { AmountFormatter } from '../components/ui/AmountFormatter';

import { useLightningOperations, useMelt, useManager, useSend } from 'hooks/coco';
import CustomKeyboard from 'components/blocks/CustomKeyboard';
import { useTheme } from 'providers/ThemeProvider';
import MintBalanceDisplay from 'components/blocks/MintBalanceDisplay';
import { popup } from '@/helper/popup';
import { HStack } from 'components/ui/View';
import { Text } from 'components/ui/Text';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, router } from 'expo-router';
import { SheetManager } from 'react-native-actions-sheet';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { Avatar } from 'components/ui/Avatar';
import Icon from 'assets/icons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { withSheetProvider } from 'hocs/withSheetProvider';
import { useProcessPaymentString } from '@/hooks/coco/useProcessPaymentString';
import { requestInvoice, utils } from 'lnurl-pay';
import { useMintStore } from 'stores/mintStore';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { getEncodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import { useRoutstrStore } from 'stores/routstrStore';
import { topUpBalance, createWalletFromToken, checkBalance } from 'helper/routstr/api';
import { ROUTSTR_PUBKEY } from 'helper/constants';

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
    lnUrlOrAddress?: string;
    routstrTopUp?: string;
  }>();

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

  const { processPaymentString } = useProcessPaymentString({
    unit,
    selectedMint,
    isFocused: true,
    onLoading: setLoading,
  });

  // Validate the amount whenever it changes
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

    // todo: is there a better way to do this? I just want to get the recently created historyEntry assosiated with my quote.
    const mintHistoryEntry = await manager.history
      .getPaginatedHistory()
      .then((h) => h.find((h) => h.type === 'mint' && h.quoteId === mintQuote.quote));

    router.replace({
      pathname: `/${params.to}`,
      params: {
        mintHistoryEntry: JSON.stringify(mintHistoryEntry),
      },
    });
  };

  const handleEcashSend = async ({ message: _message }: { message?: string }) => {
    if (!selectedMint) {
      popup({ message: 'No mint selected', emoji: '🚨', type: 'error' });
      return;
    }

    const result = await send(selectedMint, amount);

    // Handle Routstr top-up flow immediately after token creation
    if (params.routstrTopUp === 'true') {
      try {
        const encodedToken = getEncodedTokenV4(result);
        let currentApiKey = apiKey;

        // First time: Create wallet from token or use token directly as API key
        if (!currentApiKey) {
          // Try to create a persistent wallet (may not be available yet)
          const walletResponse = await createWalletFromToken(encodedToken);
          if (walletResponse) {
            // Persistent wallet created, use the API key
            currentApiKey = walletResponse.api_key;
            setApiKey(currentApiKey);
            setBalance(walletResponse.balance);
            popup({
              message: `Wallet created! Balance: ${(walletResponse.balance / 1000).toFixed(0)} sats`,
              emoji: '🎉',
              type: 'success',
            });
            // Navigate back to Routstr chat
            router.replace({
              pathname: '/userMessages',
              params: { pubkey: ROUTSTR_PUBKEY },
            });
            return;
          } else {
            // Endpoint not available, use token directly as API key
            currentApiKey = encodedToken;
            setApiKey(currentApiKey);
            // Check balance using token as API key
            try {
              const balanceData = await checkBalance(currentApiKey);
              // If response includes an api_key, use that instead (persistent key)
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
            // Navigate back to Routstr chat
            router.replace({
              pathname: '/userMessages',
              params: { pubkey: ROUTSTR_PUBKEY },
            });
            return;
          }
        } else {
          // Existing API key: Top up balance
          const topUpResult = await topUpBalance(currentApiKey, encodedToken);
          setBalance(topUpResult.new_balance);
          popup({
            message: `Balance topped up! New balance: ${(topUpResult.new_balance / 1000).toFixed(0)} sats`,
            emoji: '🎉',
            type: 'success',
          });
          // Navigate back to Routstr chat after successful top-up
          router.replace({
            pathname: '/userMessages',
            params: { pubkey: ROUTSTR_PUBKEY },
          });
          return;
        }
      } catch (error: any) {
        console.error('Failed to handle Routstr top-up:', error);
        popup({
          message: error.error?.message || 'Failed to process Routstr transaction',
          emoji: '🚨',
          type: 'error',
        });
        // Still navigate to sendToken screen even if top-up fails
      }
    }

    // todo: is there a better way to do this? I just want to get the recently created historyEntry assosiated with my token.
    const sendHistoryEntry = await manager.history
      .getPaginatedHistory()
      .then((h) =>
        h.find((h) => h.type === 'send' && getEncodedToken(h.token) === getEncodedToken(result))
      );

    router.replace({
      pathname: `/${params.to}`,
      params: {
        sendHistoryEntry: JSON.stringify(sendHistoryEntry),
      },
    });
  };

  const handleNext = async () => {
    // Don't proceed if amount is invalid
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
          return;
        }

        const { invoice } = await requestInvoice({
          lnUrlOrAddress: params.lnUrlOrAddress,
          tokens: utils.toSats(amount),
        });

        if (!invoice) {
          popup({ message: 'No invoice provided', emoji: '🚨', type: 'error' });
          return;
        }

        if (!selectedMint) {
          popup({ message: 'No mint selected', emoji: '🚨', type: 'error' });
          return;
        }

        const meltQuote = await createMeltQuote(selectedMint, invoice);

        router.push({
          pathname: `/${params.to}` as any,
          params: {
            meltQuote: JSON.stringify(meltQuote),
          },
        });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMint]);

  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      popup({ message: 'no_clipboard_address', emoji: '🚨', type: 'error' });
      return;
    }

    const scanning: ScanningData = { data: text };
    await processPaymentString(scanning);
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
            // {
            //   text: 'Contacts',
            //   icon: 'mdi:contact',
            //   variant: 'secondary',
            //   onPress: async () => router.push('/contacts'),
            //   condition: isEcashSend && !isP2PK && !hasPaymentRequest,
            // },
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
          params?.to === 'sendToken' || params?.to === 'meltQuote' ? 'send' : 'receive'
        }
        centered
      />
      <MintBalanceDisplay
        onMintSelected={handleMintSelected}
        unit={unit}
        allowedMints={params?.mints as unknown as string[]}
        allowedUnits={params?.allowedUnits as unknown as string[]}
        requireBalance={params?.to === 'sendToken' || params?.to === 'meltQuote'}
        requireValidMint={!!params?.allowedUnits}
      />
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
    </Modal>
  );
}

export default withSheetProvider(ModalScreen);
