import { useCallback, useMemo, useState } from 'react';
import { useWindowDimensions } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import opacity from 'hex-color-opacity';

import { useBalanceContext, useMints } from 'coco-cashu-react';

import { CustomKeyboard } from '@/features/auth';
import { FiatCurrencyPill } from '@/features/wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';

import { FiatAmountDisplay } from './CurrencyScreen/FiatAmountDisplay';
import { CURRENCY_CONFIG } from './CurrencyScreen/types';
import type { InputMode } from './CurrencyScreen/types';
import { useSendMachine } from '../hooks/useSendMachine';

const SATS_PER_BTC = 100_000_000;

/**
 * Standalone send currency screen driven by the send state machine.
 *
 * Responsibilities:
 * - Keyboard input (sats / fiat toggle)
 * - Sync input to the machine via setAmount / setDenomination / setMint
 * - Tap "Next" → machine.next()
 *
 * The machine handles balance validation, connectivity, offline resolution,
 * mint selection, and token creation. This screen only cares about
 * `editingAmount` and the loading overlay.
 */
export function SendCurrencyScreen() {
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

  const { keys } = useNostrKeysContext();
  const displayCurrency = useSettingsStore((s) => s.displayCurrency);
  const btcPrice = useBtcPrice(displayCurrency);
  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const { balance: liveBalances } = useBalanceContext();
  const { trustedMints } = useMints();
  const getSelectedMint = useMintStore((s) => s.getSelectedMint);

  const machine = useSendMachine();

  // --- Input state (local, synced to machine on change) ---
  const [inputMode, setInputMode] = useState<InputMode>('sats');
  const [inputAmount, setInputAmount] = useState(0);
  const [rawFiatInput, setRawFiatInput] = useState('');

  // --- Resolve selected mint ---
  const selectedMint = useMemo(() => {
    if (machine.context.mintUrl) return machine.context.mintUrl;
    if (keys?.pubkey) return getSelectedMint(keys.pubkey);
    return undefined;
  }, [machine.context.mintUrl, keys?.pubkey, getSelectedMint]);

  // Sync selected mint into machine on first render
  const [mintSynced, setMintSynced] = useState(false);
  if (!mintSynced && selectedMint) {
    machine.setMint(selectedMint);
    setMintSynced(true);
  }

  const mintBalance = selectedMint ? liveBalances[selectedMint] || 0 : 0;

  // --- Amount in sats ---
  const satsAmount = useMemo(() => {
    if (inputMode === 'sats') return inputAmount;
    if (!btcPrice) return 0;
    return Math.round((inputAmount / btcPrice) * SATS_PER_BTC);
  }, [inputMode, inputAmount, btcPrice]);

  // --- Toggle sats ↔ fiat ---
  const handleToggleInputMode = useCallback(async () => {
    await EnhancedHaptics.successHaptic();
    if (inputMode === 'sats') {
      if (btcPrice && inputAmount > 0) {
        const fiat = Math.round((inputAmount / SATS_PER_BTC) * btcPrice * 100) / 100;
        setInputAmount(fiat);
        setRawFiatInput(fiat.toString());
      } else {
        setInputAmount(0);
        setRawFiatInput('');
      }
      setInputMode('fiat');
      machine.setDenomination('fiat');
    } else {
      if (btcPrice && inputAmount > 0) {
        setInputAmount(Math.round((inputAmount / btcPrice) * SATS_PER_BTC));
      } else {
        setInputAmount(0);
      }
      setRawFiatInput('');
      setInputMode('sats');
      machine.setDenomination('sat');
    }
  }, [inputMode, inputAmount, btcPrice, machine]);

  // --- Keyboard handler ---
  const handleKeyPress = useCallback(
    (value: string) => {
      const parsed = parseFloat(value) || 0;
      setInputAmount(parsed);
      if (inputMode === 'fiat') setRawFiatInput(value);

      const newSats =
        inputMode === 'sats'
          ? parsed
          : btcPrice
            ? Math.round((parsed / btcPrice) * SATS_PER_BTC)
            : 0;
      const newFiat = inputMode === 'fiat' ? parsed : null;
      machine.setAmount(newSats, newFiat);
    },
    [inputMode, btcPrice, machine]
  );

  // --- Next button ---
  const handleNext = useCallback(() => {
    machine.next();
  }, [machine]);

  // Machine is doing work (anything past editingAmount, minus terminal states)
  const isBusy =
    machine.isValidatingBalance ||
    machine.isCheckingConnectivity ||
    machine.isOnlineSending ||
    machine.isOfflineResolving ||
    machine.isSendingToken;

  const isValidAmount = satsAmount > 0;
  const isNextDisabled = !isValidAmount || !selectedMint;

  // --- Secondary display ---
  const secondaryDisplay = useMemo(() => {
    if (!btcPrice || inputAmount === 0) {
      return inputMode === 'sats' ? `≈ ${currencyConfig.symbol}0.00` : '≈ 0 sats';
    }
    if (inputMode === 'sats') {
      const fiat = (inputAmount / SATS_PER_BTC) * btcPrice;
      return `≈ ${currencyConfig.symbol}${fiat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    const sats = Math.round((inputAmount / btcPrice) * SATS_PER_BTC);
    return `≈ ${sats.toLocaleString('en-US')} sats`;
  }, [inputMode, inputAmount, btcPrice, currencyConfig.symbol]);

  const isSatsMode = inputMode === 'sats';
  const keyboardUnit = isSatsMode ? 'sat' : displayCurrency;

  // --- Mint name for display ---
  const mintLabel = useMemo(() => {
    if (!selectedMint) return 'No mint selected';
    const mint = trustedMints.find((m) => m.mintUrl === selectedMint);
    const name = mint?.mintInfo?.name;
    if (name) return name;
    try {
      return new URL(selectedMint).hostname;
    } catch {
      return selectedMint;
    }
  }, [selectedMint, trustedMints]);

  return (
    <View style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: topPadding, paddingHorizontal: 16 }}>
        {/* Mint indicator */}
        <HStack justify="center" style={{ paddingBottom: 8 }}>
          <Text size={13} style={{ color: opacity(foreground, 0.5) }}>
            {mintLabel} · {mintBalance.toLocaleString('en-US')} sats
          </Text>
        </HStack>

        {/* Amount display */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={isCompact ? 3 : 4}>
            {isSatsMode ? (
              <AmountFormatter
                amount={inputAmount}
                unit="sat"
                size={amountTextSize}
                weight="heavy"
                animated
                useTypeColors
                transactionType="send"
                centered
              />
            ) : (
              <FiatAmountDisplay
                rawInput={rawFiatInput}
                symbol={currencyConfig.symbol}
                size={amountTextSize}
                activeColor={rawFiatInput ? danger : opacity(foreground, 0.4)}
                placeholderColor={opacity(danger, 0.35)}
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

        {/* Error display */}
        {machine.error && (
          <HStack justify="center" style={{ paddingVertical: 8 }}>
            <Text size={13} style={{ color: danger }}>
              {machine.error.message}
            </Text>
          </HStack>
        )}
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={0}>
        <CustomKeyboard
          loading={isBusy}
          unit={keyboardUnit}
          compact={isCompact}
          onKeyPress={handleKeyPress}
        />
        <HStack justify="center" align="center">
          <ButtonHandler
            buttons={[
              {
                text: 'Next',
                icon: 'lucide:arrow-right',
                variant: 'primary',
                onPress: async () => {
                  handleNext();
                },
                loading: isBusy,
                disabled: isNextDisabled,
              },
            ]}
          />
        </HStack>
      </BottomButtons>
    </View>
  );
}
