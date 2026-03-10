import {
  noClipboardAddressPopup,
  routstrTopUpSuccessPopup,
  routstrWalletCreatedPopup,
  routstrInitializedPopup,
  routstrTransactionFailedPopup,
  noLightningAddressPopup,
  noPaymentRequestPopup,
  invalidNostrTransportPopup,
  invalidRecipientPopup,
  sendPaymentFailedPopup,
} from '@/shared/lib/popup';
import { decodePaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import { SendHistoryEntry } from 'coco-cashu-core';
import { CustomKeyboard } from '@/features/auth';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import * as Clipboard from 'expo-clipboard';
import { checkBalance, createWalletFromToken, topUpBalance } from '@/shared/lib/routstr/api';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import opacity from 'hex-color-opacity';
import { usePaymentMachine } from '@/shared/hooks/usePaymentMachine';
import { useBalanceContext, useMints } from 'coco-cashu-react';
import { FiatCurrencyPill } from '@/features/wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

import { FiatAmountDisplay } from './FiatAmountDisplay';
import { useOfflineSendability } from './useOfflineSendability';
import { useSendRouteAnalysis } from './useSendRouteAnalysis';
import { parseFiatInputToMinorUnit } from './utils';
import type { CurrencyScreenProps, InputMode } from './types';
import { CURRENCY_CONFIG } from './types';

export type { CurrencyScreenProps, CurrencyScreenParams } from './types';

export function CurrencyScreen({
  params,
  onMintQuoteCreated,
  onSendTokenCreated,
  onMeltQuoteReady,
  onCameraPress,
  onRoutstrSuccess,
  processPaymentStringFn,
  onInsufficientBalance,
  onSendModeChange,
  onSendModeDebugChange,
}: CurrencyScreenProps) {
  // --- Theme & layout ---
  const [foreground, background, danger] = useThemeColor([
    'foreground',
    'background',
    'danger',
  ] as const);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isCompact = screenHeight <= 760;
  const isVeryCompact = screenHeight <= 680;
  const amountTextSize = isVeryCompact ? 36 : isCompact ? 42 : 48;
  const topPadding = insets.top + (isCompact ? 12 : 24);

  // --- Services & stores ---
  const { isOffline } = useOfflineStatus();
  const { setApiKey, setBalance, balance } = useRoutstrStore();
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((s) => s.selectedMints);
  const setSelectedMint = useMintStore((s) => s.setSelectedMint);
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const mockOffline = useSettingsStore((s) => s.mockOffline);
  const btcPrice = useBtcPrice(displayCurrency);
  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const { balance: liveBalances } = useBalanceContext();
  const { trustedMints } = useMints();

  // --- Input state ---
  const [inputMode, setInputMode] = useState<InputMode>('sats');
  const [inputAmount, setInputAmount] = useState(params?.amount ? parseFloat(params.amount) : 0);
  const [rawFiatInput, setRawFiatInput] = useState('');
  const [loading, setLoading] = useState(false);

  const unit = params?.unit?.toLowerCase() || 'sat';
  const isSendTokenFlow = params.to === 'sendToken';
  const isSendOperation = params.to === 'sendToken' || params.to === 'meltQuote' || params.to === 'paymentRequest';
  const transactionType = isSendOperation ? 'send' : 'receive';

  // --- Mint selection ---
  const storeSelectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;

  const allowedMints = useMemo(() => {
    if (!params.allowedMints) return undefined;
    try {
      return JSON.parse(params.allowedMints) as string[];
    } catch {
      return undefined;
    }
  }, [params.allowedMints]);

  const selectedMint = useMemo(() => {
    if (params.selectedMintUrl) return params.selectedMintUrl;
    if (!allowedMints?.length) return storeSelectedMint;
    if (storeSelectedMint && allowedMints.includes(storeSelectedMint)) return storeSelectedMint;

    const best = trustedMints
      .filter((m) => allowedMints.includes(m.mintUrl))
      .map((m) => ({ url: m.mintUrl, balance: liveBalances[m.mintUrl] || 0 }))
      .sort((a, b) => b.balance - a.balance);

    return best.length > 0 ? best[0].url : storeSelectedMint;
  }, [params.selectedMintUrl, allowedMints, storeSelectedMint, trustedMints, liveBalances]);

  useEffect(() => {
    if (keys?.pubkey && selectedMint && storeSelectedMint !== selectedMint && allowedMints?.length) {
      setSelectedMint(keys.pubkey, selectedMint);
    }
  }, [keys?.pubkey, selectedMint, storeSelectedMint, allowedMints, setSelectedMint]);

  const mintBalance = selectedMint ? liveBalances[selectedMint] || 0 : 0;

  // --- Amount conversions ---
  const satsAmount = useMemo(() => {
    if (inputMode === 'sats') return inputAmount;
    if (!btcPrice) return 0;
    return Math.round((inputAmount / btcPrice) * 100_000_000);
  }, [inputMode, inputAmount, btcPrice]);

  const amount = satsAmount;

  const fiatMinorUnitAmount = useMemo(
    () => parseFiatInputToMinorUnit(rawFiatInput, inputAmount),
    [inputAmount, rawFiatInput]
  );

  // --- Offline analysis ---
  const offlineSendability = useOfflineSendability(isSendTokenFlow, selectedMint, mintBalance);

  const { sendMode, debugInfo: sendModeDebugInfo } = useSendRouteAnalysis({
    isSendTokenFlow,
    selectedMint,
    amount,
    mintBalance,
    inputMode,
    fiatMinorUnitAmount,
    btcPrice,
    currencySymbol: currencyConfig.symbol,
    offlineSendability,
  });

  // --- Emit send mode to parent ---
  useEffect(() => {
    onSendModeChange?.(isSendTokenFlow ? sendMode : null);
  }, [onSendModeChange, isSendTokenFlow, sendMode]);

  useEffect(() => {
    onSendModeDebugChange?.(isSendTokenFlow ? sendModeDebugInfo : null);
  }, [onSendModeDebugChange, isSendTokenFlow, sendModeDebugInfo]);

  // --- Payment machine ---
  const machine = usePaymentMachine({
    sendBranch: 'ecash',
    mintUrl: selectedMint,
    mintBalance,
    isOffline: mockOffline || isOffline,
    offlineSendability: offlineSendability
      ? { reachableSums: offlineSendability.reachableSums, totalReadyBalance: offlineSendability.totalReadyBalance }
      : null,
    unit,
    btcPrice,
    onSuccess: (entry, token) => {
      setLoading(false);
      if (params.routstrTopUp === 'true') {
        handleRoutstrTopUp(entry, token ?? null);
      } else {
        onSendTokenCreated(entry);
      }
    },
    onPaymentRequestSent: (entry) => {
      setLoading(false);
      onSendTokenCreated(entry, { nostrSent: true });
    },
    onMintQuoteReady: (entry) => { setLoading(false); onMintQuoteCreated(entry); },
    onInsufficientBalance: (amt, u) => { setLoading(false); onInsufficientBalance?.(amt, u); },
    onError: () => setLoading(false),
    onNoMint: () => setLoading(false),
    onCancelled: () => setLoading(false),
  });

  // --- Validity (derived, no state needed — machine guards handle the rest) ---
  const isValidAmount = satsAmount > 0 || (!!params.paymentRequest && !!params.amount);

  // --- Toggle input mode ---
  const handleToggleInputMode = useCallback(async () => {
    await EnhancedHaptics.successHaptic();

    if (inputMode === 'sats') {
      if (btcPrice && inputAmount > 0) {
        const fiat = Math.round(((inputAmount / 100_000_000) * btcPrice) * 100) / 100;
        setInputAmount(fiat);
        setRawFiatInput(fiat.toString());
      } else {
        setInputAmount(0);
        setRawFiatInput('');
      }
      setInputMode('fiat');
    } else {
      if (btcPrice && inputAmount > 0) {
        setInputAmount(Math.round((inputAmount / btcPrice) * 100_000_000));
      } else {
        setInputAmount(0);
      }
      setRawFiatInput('');
      setInputMode('sats');
    }
  }, [inputMode, inputAmount, btcPrice]);

  // --- Routstr top-up ---
  const handleRoutstrTopUp = useCallback(
    async (historyEntry: SendHistoryEntry, token: string | null) => {
      if (!token) return;
      try {
        const currentApiKey = useRoutstrStore.getState().apiKey;

        if (currentApiKey) {
          const result = await topUpBalance(currentApiKey, token);
          const newBalance = (balance || 0) + result.added_amount;
          setBalance(newBalance);
          routstrTopUpSuccessPopup({ balance: `${(newBalance / 1000).toFixed(0)} sats` });
          onRoutstrSuccess?.();
          return;
        }

        const wallet = await createWalletFromToken(token);
        if (wallet?.api_key) {
          setApiKey(wallet.api_key);
          setBalance(wallet.balance);
          routstrWalletCreatedPopup({ balance: `${(wallet.balance / 1000).toFixed(0)} sats` });
          onRoutstrSuccess?.();
          return;
        }

        try {
          const balanceData = await checkBalance(token);
          setApiKey(balanceData.api_key || token);
          setBalance(balanceData.balance);
          routstrInitializedPopup({ balance: `${(balanceData.balance / 1000).toFixed(0)} sats` });
        } catch {
          setApiKey(token);
          routstrInitializedPopup();
        }
        onRoutstrSuccess?.();
      } catch (error: any) {
        console.error('Failed to handle Routstr top-up:', error);
        routstrTransactionFailedPopup({ text: error.error?.message });
      }
    },
    [balance, onRoutstrSuccess, setApiKey, setBalance]
  );

  // --- Next button ---
  const handleNext = async () => {
    if (!isValidAmount) return;

    setLoading(true);

    switch (params.to) {
      case 'mintQuote':
        machine.setReceiveAmount(amount);
        machine.requestInvoice();
        break;

      case 'sendToken':
        machine.setAmount(amount);
        machine.next();
        break;

      case 'meltQuote':
        if (!params.lnUrlOrAddress) {
          noLightningAddressPopup();
          setLoading(false);
          return;
        }
        onMeltQuoteReady(params.lnUrlOrAddress, amount);
        setLoading(false);
        break;

      case 'paymentRequest':
        if (!params.paymentRequest) {
          noPaymentRequestPopup();
          setLoading(false);
          return;
        }
        try {
          const decoded = decodePaymentRequest(params.paymentRequest);
          const nostrTransport = decoded.transport?.find(
            (t) => t.type === PaymentRequestTransportType.NOSTR
          );
          if (!nostrTransport?.target) {
            invalidNostrTransportPopup();
            setLoading(false);
            return;
          }
          const decodedNip19 = nip19.decode(nostrTransport.target);
          if ((decodedNip19.type as string) !== 'nprofile') {
            invalidRecipientPopup();
            setLoading(false);
            return;
          }
        } catch {
          sendPaymentFailedPopup();
          setLoading(false);
          return;
        }
        machine.setPaymentRequest(params.paymentRequest);
        machine.setAmount(amount);
        machine.next();
        break;

      default:
        setLoading(false);
        break;
    }
  };

  // --- Paste ---
  const handlePastePress = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      noClipboardAddressPopup();
      return;
    }
    if (processPaymentStringFn) {
      await processPaymentStringFn({ data: text, type: 'paste' });
    }
  };

  // --- Secondary display ---
  const secondaryDisplay = useMemo(() => {
    if (!btcPrice || inputAmount === 0) {
      return inputMode === 'sats' ? `≈ ${currencyConfig.symbol}0.00` : '≈ 0 sats';
    }
    if (inputMode === 'sats') {
      const fiat = (inputAmount / 100_000_000) * btcPrice;
      return `≈ ${currencyConfig.symbol}${fiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const sats = Math.round((inputAmount / btcPrice) * 100_000_000);
    return `≈ ${sats.toLocaleString('en-US')} sats`;
  }, [inputMode, inputAmount, btcPrice, currencyConfig.symbol]);

  // --- Button disabled logic ---
  const isNextDisabled = useMemo(() => {
    if (!isValidAmount) return true;
    const isNut18 = params.to === 'paymentRequest' && params.paymentRequest;
    const isLegacy = params.paymentRequest && params.mints && params.allowedUnits;
    if (isNut18 || !isLegacy) return false;
    return !(
      (params.mints as unknown as string[])?.includes(selectedMint || '') &&
      (params.allowedUnits as unknown as string[])?.includes(unit.toUpperCase() || '')
    );
  }, [isValidAmount, params, selectedMint, unit]);

  if (!params) return null;

  const hasPaymentRequest = !!params.paymentRequest;
  const hasFixedAmount = !!params.amount;
  const showPaste = isSendTokenFlow && !hasPaymentRequest && !!processPaymentStringFn;
  const showScanQR = isSendTokenFlow && !hasPaymentRequest;
  const showNextIcon = isSendTokenFlow;
  const isSatsMode = inputMode === 'sats';
  const isSending = transactionType === 'send';
  const keyboardUnit = isSatsMode ? 'sat' : displayCurrency;

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: topPadding, paddingHorizontal: 16 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={isCompact ? 3 : 4}>
            {isSatsMode ? (
              <AmountFormatter
                amount={inputAmount}
                unit={unit}
                size={amountTextSize}
                weight="heavy"
                animated
                useTypeColors
                transactionType={transactionType}
                centered
              />
            ) : (
              <FiatAmountDisplay
                rawInput={rawFiatInput}
                symbol={currencyConfig.symbol}
                size={amountTextSize}
                activeColor={
                  rawFiatInput
                    ? isSending ? danger : foreground
                    : opacity(foreground, 0.4)
                }
                placeholderColor={opacity(
                  isSending ? danger : foreground,
                  0.35
                )}
              />
            )}
            <FiatCurrencyPill
              displayText={secondaryDisplay}
              onPress={handleToggleInputMode}
              showToggleGlyph
              enableCurrencyMenu={false}
            />
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        {!hasFixedAmount && (
          <CustomKeyboard
            loading={loading}
            unit={keyboardUnit}
            compact={isCompact}
            onKeyPress={(value: string) => {
              setInputAmount(parseFloat(value) || 0);
              if (inputMode === 'fiat') setRawFiatInput(value);
            }}
          />
        )}
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Paste',
                icon: 'lets-icons:copy',
                variant: 'secondary',
                onPress: handlePastePress,
                condition: showPaste,
              },
              {
                text: 'Next',
                ...(showNextIcon && { icon: 'lucide:arrow-right' }),
                variant: 'primary',
                onPress: handleNext,
                loading,
                disabled: isNextDisabled,
              },
              {
                text: 'Scan QR',
                icon: 'stash:qr-code',
                variant: 'secondary',
                onPress: async () => onCameraPress(unit),
                condition: showScanQR,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}
