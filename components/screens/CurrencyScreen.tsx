/**
 * @fileoverview Shared Currency/Amount selection screen component
 *
 * This module provides the core UI and logic for amount selection.
 * Navigation routing is handled by callbacks passed from route wrappers.
 *
 * ## Fiat Input Mode Behavior
 *
 * The fiat input has special styling and behavior to match the sats input experience:
 *
 * ### Display Styling
 * - **Receive transactions**: Active digits use `primaryColor('0')` (white)
 * - **Send transactions**: Active digits use `shadeColor('300')` (shade color)
 * - Placeholder decimals use the same color at 35% opacity (semi-transparent)
 * - Empty state uses `primaryColor('400')` (dimmed)
 *
 * ### Decimal Placeholder Examples
 *
 * | User Types | Display                    | Notes                                    |
 * |------------|----------------------------|------------------------------------------|
 * | (nothing)  | `$0`                       | Dimmed placeholder color                 |
 * | `1`        | `$1`                       | No decimals shown                        |
 * | `12`       | `$12`                      | No decimals shown                        |
 * | `12.`      | `$12.` + `00`              | Decimal active, "00" semi-transparent    |
 * | `12.3`     | `$12.3` + `0`              | "0" semi-transparent placeholder         |
 * | `12.34`    | `$12.34`                   | Full amount, no placeholder              |
 * | `0`        | `$0` + `.00`               | Special: shows decimal placeholder       |
 * | `0.`       | `$0.` + `00`               | Decimal active, "00" semi-transparent    |
 * | `0.5`      | `$0.5` + `0`               | "0" semi-transparent placeholder         |
 * | `0.50`     | `$0.50`                    | Full amount, no placeholder              |
 *
 * ### Zero Replacement Behavior
 *
 * When in fiat mode with value "0", typing a digit (1-9) replaces the zero:
 * - Type `0` → `$0.00` (placeholder shown, ready for decimals)
 * - Type `.` → `$0.00` (continue entering like `$0.50`)
 * - Type `5` → `$5` (zero is REPLACED, not appended to make "05")
 *
 * This prevents invalid inputs like "05" and removes "0" from the input stack,
 * so backspace doesn't reveal a stale zero.
 *
 * ### Mode Toggle Behavior
 *
 * - Sats → Fiat: Converts amount and sets `rawFiatInput` for display
 * - Fiat → Sats: Converts amount and clears `rawFiatInput`
 * - The `rawFiatInput` state preserves the exact typed string to track decimals
 *
 * @see CustomKeyboard - handles the zero replacement logic
 * @see FiatAmountDisplay - handles the decimal placeholder rendering
 */

import { popup } from '@/helper/popup';
import { getEncodedTokenV4 } from '@cashu/cashu-ts';
import Icon from 'assets/icons';
import { MintHistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import CustomKeyboard from 'components/blocks/CustomKeyboard';
import WalletHeaderTitle from 'components/blocks/WalletHeaderTitle';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { Avatar } from 'components/ui/Avatar';
import { BottomButtons } from 'components/ui/BottomButtons';
import { ButtonHandler } from 'components/ui/ButtonHandler';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { Text } from 'components/ui/Text';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { HStack, View, VStack } from 'components/ui/View';
import * as Clipboard from 'expo-clipboard';
import { checkBalance, createWalletFromToken, topUpBalance } from 'helper/routstr/api';
import {
  useLightningOperations,
  useManager,
  useSendWithHistory,
  useBalanceContext,
} from 'hooks/coco';
import { useNostrKeysContext } from 'providers/NostrKeysProvider';
import { useTheme } from 'providers/ThemeProvider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMintStore } from 'stores/mintStore';
import { useRoutstrStore } from 'stores/routstrStore';
import { useSettingsStore, DisplayCurrency } from 'stores/settingsStore';
import { useBtcPrice } from 'stores/pricelistStore';
import opacity from 'hex-color-opacity';

// Currency display configuration
const CURRENCY_CONFIG: Record<DisplayCurrency, { symbol: string; label: string }> = {
  usd: { symbol: '$', label: 'USD' },
  eur: { symbol: '€', label: 'EUR' },
  gbp: { symbol: '£', label: 'GBP' },
};

type InputMode = 'sats' | 'fiat';

/**
 * Displays fiat amount with styled decimal placeholders
 * - Shows no decimals when no decimal entered
 * - Shows semi-transparent placeholder for remaining decimal places
 */
interface FiatAmountDisplayProps {
  rawInput: string;
  symbol: string;
  activeColor: string;
  placeholderColor: string;
}

function FiatAmountDisplay({
  rawInput,
  symbol,
  activeColor,
  placeholderColor,
}: FiatAmountDisplayProps) {
  // Determine what to display based on raw input
  const hasDecimal = rawInput.includes('.');
  const parts = rawInput.split('.');
  const wholePart = parts[0] || '';
  const decimalPart = parts[1] || '';

  // Format the whole number part with commas, default to '0' if empty
  const parsedWhole = parseInt(wholePart, 10);
  const formattedWhole = !isNaN(parsedWhole) ? parsedWhole.toLocaleString('en-US') : '0';

  // Show decimal placeholder when:
  // 1. User has typed a decimal point, OR
  // 2. User typed "0" (they'll need to add decimals like $0.50)
  const showDecimalSection = hasDecimal || wholePart === '0';

  // Calculate placeholder decimals needed (2 total for fiat)
  const placeholderDecimals = showDecimalSection
    ? '0'.repeat(Math.max(0, 2 - decimalPart.length))
    : '';

  return (
    <HStack align="baseline" justify="center">
      <Text size={48} weight="heavy" style={{ color: activeColor }}>
        {symbol}
        {formattedWhole}
      </Text>
      {showDecimalSection && (
        <>
          {/* Show the decimal point - in active color if user typed it, placeholder if auto-shown for "0" */}
          <Text
            size={48}
            weight="heavy"
            style={{ color: hasDecimal ? activeColor : placeholderColor }}>
            .
          </Text>
          {/* Show any typed decimal digits */}
          {decimalPart && (
            <Text size={48} weight="heavy" style={{ color: activeColor }}>
              {decimalPart}
            </Text>
          )}
          {/* Show placeholder for remaining decimal places */}
          {placeholderDecimals && (
            <Text size={48} weight="heavy" style={{ color: placeholderColor }}>
              {placeholderDecimals}
            </Text>
          )}
        </>
      )}
    </HStack>
  );
}

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
  /** Navigate to MeltQuoteScreen with lnUrlOrAddress and amount - screen handles quote creation */
  onMeltQuoteReady: (lnUrlOrAddress: string, amount: number) => void;
  onCameraPress: (unit: string) => void;
  onReceiveTokenScanned?: (receiveHistoryEntry: ReceiveHistoryEntry & { token: string }) => void;
  onRoutstrSuccess?: () => void;
  processPaymentStringFn?: (scanning: { data: string; type?: string }) => Promise<unknown>;
  /** Called when user tries to send more than current mint's balance */
  onInsufficientBalance?: (amount: number, unit: string) => void;
}

export function CurrencyScreen({
  params,
  onMintQuoteCreated,
  onSendTokenCreated,
  onMeltQuoteReady,
  onCameraPress,
  onRoutstrSuccess,
  processPaymentStringFn,
  onInsufficientBalance,
}: CurrencyScreenProps) {
  const { getPrimaryColor, getGreenColor, getShadeColor } = useTheme();
  const insets = useSafeAreaInsets();

  const { send } = useSendWithHistory();
  const { requestLightningInvoice } = useLightningOperations();
  const { setApiKey, setBalance, balance } = useRoutstrStore();

  // Get user's preferred fiat currency and BTC price
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const btcPrice = useBtcPrice(displayCurrency);
  const currencyConfig = CURRENCY_CONFIG[displayCurrency];

  // Input mode: 'sats' or 'fiat'
  const [inputMode, setInputMode] = useState<InputMode>('sats');
  // The raw input amount in current mode (sats or fiat cents)
  const [inputAmount, setInputAmount] = useState(params?.amount ? parseFloat(params.amount) : 0);
  // Track raw input string for fiat mode to preserve decimal state
  const [rawFiatInput, setRawFiatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const selectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const [unit, setUnit] = useState(params?.unit?.toLowerCase() || 'sat');
  const [isValidAmount, setIsValidAmount] = useState(false);

  // Get live balance for the selected mint
  const { balance: liveBalances } = useBalanceContext();
  const mintBalance = selectedMint ? liveBalances[selectedMint] || 0 : 0;

  // Convert input amount to sats (for API calls)
  const satsAmount = useMemo(() => {
    if (inputMode === 'sats') {
      return inputAmount;
    }
    // Convert fiat to sats: fiat / (btcPrice / 100_000_000)
    if (!btcPrice) return 0;
    const sats = Math.round((inputAmount / btcPrice) * 100_000_000);
    return sats;
  }, [inputMode, inputAmount, btcPrice]);

  // The amount to use for API calls (always in sats)
  const amount = satsAmount;

  // Toggle between sats and fiat input modes
  const handleToggleInputMode = useCallback(async () => {
    await EnhancedHaptics.successHaptic();

    if (inputMode === 'sats') {
      // Switching to fiat: convert current sats to fiat
      if (btcPrice && inputAmount > 0) {
        const fiat = (inputAmount / 100_000_000) * btcPrice;
        const roundedFiat = Math.round(fiat * 100) / 100;
        setInputAmount(roundedFiat);
        // Format with up to 2 decimal places, preserving decimals when present
        const fiatStr = roundedFiat.toString();
        // If the number has decimals but fewer than 2, keep as is (user can continue typing)
        setRawFiatInput(fiatStr);
      } else {
        setInputAmount(0);
        setRawFiatInput('');
      }
      setInputMode('fiat');
    } else {
      // Switching to sats: convert current fiat to sats
      if (btcPrice && inputAmount > 0) {
        const sats = Math.round((inputAmount / btcPrice) * 100_000_000);
        setInputAmount(sats);
      } else {
        setInputAmount(0);
      }
      setRawFiatInput('');
      setInputMode('sats');
    }
  }, [inputMode, inputAmount, btcPrice]);

  useEffect(() => {
    setIsValidAmount(satsAmount > 0);
  }, [satsAmount]);

  const manager = useManager();

  const handleMintSelected = async (mint: { id: string; unit: string }) => {
    const newUnit = mint.unit.toLowerCase();
    setUnit(newUnit);
  };

  const handleLightningReceive = async () => {
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

  const handleEcashSend = async () => {
    if (!selectedMint) {
      popup({ message: 'No mint selected', emoji: '🚨', type: 'error' });
      return;
    }

    // useSendWithHistory returns both the token and the history entry
    // This is the coco-idiomatic way - no need to search paginated history
    const { token, historyEntry } = await send(selectedMint, amount);

    // Handle Routstr top-up flow
    if (params.routstrTopUp === 'true') {
      try {
        const encodedToken = getEncodedTokenV4(token);

        // Get the latest apiKey directly from the store to avoid stale closure
        const currentApiKey = useRoutstrStore.getState().apiKey;
        console.log('Routstr top-up: Current API key exists:', !!currentApiKey);

        if (currentApiKey) {
          // We have an existing API key - use top-up endpoint
          console.log('Routstr top-up: Using existing wallet, calling topUpBalance');
          const topUpResult = await topUpBalance(currentApiKey, encodedToken);
          setBalance(balance ? balance + topUpResult.added_amount : topUpResult.added_amount);
          popup({
            message: `Balance topped up! New balance: ${(balance ? balance + topUpResult.added_amount : topUpResult.added_amount / 1000).toFixed(0)} sats`,
            emoji: '🎉',
            type: 'success',
          });
          onRoutstrSuccess?.();
          return;
        } else {
          // No API key - create a new wallet
          console.log('Routstr top-up: No existing wallet, creating new one');

          // Try the /wallet/create endpoint first (may not exist yet per docs)
          const walletResponse = await createWalletFromToken(encodedToken);

          if (walletResponse && walletResponse.api_key) {
            // Wallet created successfully via /wallet/create
            console.log('Routstr top-up: Wallet created via /wallet/create');
            setApiKey(walletResponse.api_key);
            setBalance(walletResponse.balance);
            popup({
              message: `Wallet created! Balance: ${(walletResponse.balance / 1000).toFixed(0)} sats`,
              emoji: '🎉',
              type: 'success',
            });
            onRoutstrSuccess?.();
            return;
          }

          // Fallback: Use the Cashu token directly as API key (per Routstr docs)
          // "Currently, you can use Cashu tokens directly as API keys"
          console.log('Routstr top-up: Falling back to using token directly');
          try {
            const balanceData = await checkBalance(encodedToken);

            // If server returns a persistent API key, use that for future requests
            const persistentKey = balanceData.api_key || encodedToken;
            setApiKey(persistentKey);
            setBalance(balanceData.balance);

            console.log(
              'Routstr top-up: Stored API key:',
              persistentKey !== encodedToken ? 'persistent key from server' : 'token as key'
            );

            popup({
              message: `Routstr wallet initialized! Balance: ${(balanceData.balance / 1000).toFixed(0)} sats`,
              emoji: '🎉',
              type: 'success',
            });
          } catch (balanceError) {
            console.error('Failed to check balance:', balanceError);
            // Still store the token as API key - it may work for subsequent requests
            setApiKey(encodedToken);
            popup({
              message: 'Routstr wallet initialized! You can now use Routstr AI.',
              emoji: '🎉',
              type: 'success',
            });
          }
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

    // Pass the history entry directly - no need to search through history
    onSendTokenCreated(historyEntry);
  };

  const handleNext = async () => {
    if (!isValidAmount) return;

    // Check for insufficient balance on send operations
    const isSendOperation = params.to === 'sendToken' || params.to === 'meltQuote';
    if (isSendOperation && amount > mintBalance) {
      // Redirect to mint selection with minimum amount filter
      if (onInsufficientBalance) {
        onInsufficientBalance(amount, unit);
        return;
      }
    }

    setLoading(true);

    switch (params.to) {
      case 'mintQuote':
        try {
          await handleLightningReceive();
        } finally {
          setLoading(false);
        }
        break;
      case 'sendToken':
        try {
          await handleEcashSend();
        } finally {
          setLoading(false);
        }
        break;
      case 'meltQuote':
        // Navigate to MeltQuoteScreen with lnUrlOrAddress and amount
        // The screen will handle LNURL resolution and quote creation
        if (!params.lnUrlOrAddress) {
          popup({ message: 'No lightning address provided', emoji: '🚨', type: 'error' });
          setLoading(false);
          return;
        }

        onMeltQuoteReady(params.lnUrlOrAddress, amount);
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

  // Get the unit to pass to keyboard based on input mode
  const keyboardUnit = inputMode === 'sats' ? 'sat' : displayCurrency;

  // Format the secondary display value
  const secondaryDisplay = useMemo(() => {
    if (inputMode === 'sats') {
      // Show fiat equivalent
      if (!btcPrice || inputAmount === 0) return null;
      const fiat = (inputAmount / 100_000_000) * btcPrice;
      return `≈ ${currencyConfig.symbol}${fiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      // Show sats equivalent
      if (!btcPrice || inputAmount === 0) return null;
      const sats = Math.round((inputAmount / btcPrice) * 100_000_000);
      return `≈ ${sats.toLocaleString('en-US')} sats`;
    }
  }, [inputMode, inputAmount, btcPrice, currencyConfig.symbol]);

  if (!params) return null;

  return (
    <View style={{ flex: 1, backgroundColor: getPrimaryColor('950') }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: insets.top + 48,
        }}>
        <VStack align="center" spacing={4}>
          {/* Main amount display */}
          {inputMode === 'sats' ? (
            <AmountFormatter
              amount={inputAmount}
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
          ) : (
            <FiatAmountDisplay
              rawInput={rawFiatInput}
              symbol={currencyConfig.symbol}
              activeColor={
                rawFiatInput
                  ? params?.to === 'sendToken' || params?.to === 'meltQuote'
                    ? getShadeColor('300')
                    : getPrimaryColor('0')
                  : getPrimaryColor('400')
              }
              placeholderColor={opacity(
                params?.to === 'sendToken' || params?.to === 'meltQuote'
                  ? getShadeColor('300')
                  : getPrimaryColor('0'),
                0.35
              )}
            />
          )}
        </VStack>
        <View style={{ marginVertical: 8 }}>
          <WalletHeaderTitle
            width={200}
            unit={unit}
            requireBalance={params?.to === 'sendToken' || params?.to === 'meltQuote'}
            showAddMintsButton={!(params?.to === 'sendToken' || params?.to === 'meltQuote')}
            showDetailsButton={!(params?.to === 'sendToken' || params?.to === 'meltQuote')}
            onMintSelected={handleMintSelected}
          />
        </View>
        <VStack align="center" spacing={4}>
          {/* Secondary converted value with toggle - always visible */}
          <TouchableOpacity onPress={handleToggleInputMode}>
            <HStack
              align="center"
              justify="center"
              spacing={6}
              style={{
                backgroundColor: opacity(getGreenColor('500'), 0.15),
                borderRadius: 100,
                paddingHorizontal: 14,
                paddingVertical: 6,
              }}>
              <Text
                size={14}
                bold
                overpass
                style={{ color: getGreenColor('300'), letterSpacing: 0.3 }}>
                {secondaryDisplay ||
                  (inputMode === 'sats' ? `≈ ${currencyConfig.symbol}0.00` : '≈ 0 sats')}
              </Text>
              <Icon name="fluent:arrow-swap-16-filled" size={14} color={getGreenColor('300')} />
            </HStack>
          </TouchableOpacity>
        </VStack>
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
            unit={keyboardUnit}
            onKeyPress={(value: string) => {
              setInputAmount(parseFloat(value) || 0);
              if (inputMode === 'fiat') {
                setRawFiatInput(value);
              }
            }}
          />
        )}
        {renderButtons()}
      </BottomButtons>
    </View>
  );
}
