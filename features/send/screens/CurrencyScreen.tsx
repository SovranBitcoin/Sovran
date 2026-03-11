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

import {
  noMintSelectedPopup,
  noClipboardAddressPopup,
  offlineSendSuggestionsPopup,
  routstrTopUpSuccessPopup,
  routstrWalletCreatedPopup,
  routstrInitializedPopup,
  routstrTransactionFailedPopup,
  noLightningAddressPopup,
  noPaymentRequestPopup,
  invalidNostrTransportPopup,
  invalidRecipientPopup,
  paymentStatusPopup,
  sendPaymentFailedPopup,
} from '@/shared/lib/popup';
import {
  getEncodedTokenV4,
  decodePaymentRequest,
  PaymentRequestTransportType,
  PaymentRequestPayload,
} from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import type { ProfilePointer } from 'nostr-tools/nip19';
import { MintHistoryEntry, ReceiveHistoryEntry, SendHistoryEntry } from 'coco-cashu-core';
import { CustomKeyboard } from '@/features/auth';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { BottomButtons } from '@/shared/ui/composed/BottomButtons';
import { ButtonHandler } from '@/shared/ui/composed/ButtonHandler';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { Text } from '@/shared/ui/primitives/Text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { View } from '@/shared/ui/primitives/View/View';
import * as Clipboard from 'expo-clipboard';
import { checkBalance, createWalletFromToken, topUpBalance } from '@/shared/lib/routstr/api';
import { useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useOfflineStatus } from '@/shared/providers/OfflineProvider';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMintStore } from '@/shared/stores/profile/mintStore';
import { useRoutstrStore } from '@/shared/stores/profile/routstrStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { useSettingsStore, DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import opacity from 'hex-color-opacity';
import { useLightningOperations } from '@/features/receive';
import {
  buildExactOfflineAmountIndex,
  getOfflineFiatSendSuggestions,
  getOfflineSendSuggestions,
  getSatRangeForDisplayedFiatMinorUnit,
} from '@/features/send/lib/offlineSendSuggestions';
import { useSendWithHistory } from '@/features/send';
import { useNostrDirectMessage } from '@/features/user';
import { useBalanceContext, useManager, useMints } from 'coco-cashu-react';
import { captureAndStoreLocation } from '@/shared/hooks/useTransactionLocation';
import { FiatCurrencyPill } from '@/features/wallet';
import { useThemeColor } from '@/shared/hooks/useThemeColor';

// Currency display configuration
const CURRENCY_CONFIG: Record<DisplayCurrency, { symbol: string; label: string }> = {
  usd: { symbol: '$', label: 'USD' },
  eur: { symbol: '€', label: 'EUR' },
  gbp: { symbol: '£', label: 'GBP' },
};

function parseFiatInputToMinorUnit(rawInput: string, fallbackAmount: number): number | null {
  const trimmedInput = rawInput.trim();
  if (!trimmedInput) {
    return Number.isFinite(fallbackAmount) ? Math.round(fallbackAmount * 100) : null;
  }

  const [wholePartRaw = '0', decimalPartRaw = ''] = trimmedInput.split('.');
  if (!/^\d*$/.test(wholePartRaw) || !/^\d*$/.test(decimalPartRaw)) {
    return null;
  }

  const wholePart = wholePartRaw === '' ? 0 : Number.parseInt(wholePartRaw, 10);
  const decimalPart = Number.parseInt(`${decimalPartRaw}00`.slice(0, 2), 10);

  if (!Number.isFinite(wholePart) || !Number.isFinite(decimalPart)) {
    return null;
  }

  return wholePart * 100 + decimalPart;
}

function formatFiatMinorUnit(amountMinorUnit: number, symbol: string): string {
  return `${symbol}${(amountMinorUnit / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSatsAmount(amount: number): string {
  return `${amount.toLocaleString('en-US')} sats`;
}

function formatAmountList(
  amounts: number[],
  formatter: (amount: number) => string,
  limit: number = 8
): string {
  if (amounts.length === 0) {
    return 'none';
  }

  const visibleAmounts = amounts.slice(0, limit).map(formatter);
  if (amounts.length <= limit) {
    return visibleAmounts.join(', ');
  }

  return `${visibleAmounts.join(', ')}, ...`;
}

function orderCandidatesByCloseness(candidates: number[], requestedAmount: number): number[] {
  return [...candidates].sort((left, right) => {
    const distanceDifference = Math.abs(left - requestedAmount) - Math.abs(right - requestedAmount);
    if (distanceDifference !== 0) {
      return distanceDifference;
    }

    return left - right;
  });
}

type InputMode = 'sats' | 'fiat';
type SendMode = 'offline' | 'online';
type SendModeDebugInfo = {
  title: string;
  message: string;
};

type OfflineSendabilityState = {
  reachableSums: number[];
  reachableAmounts: Set<number>;
  totalReadyBalance: number;
};

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
  size?: number;
}

function FiatAmountDisplay({
  rawInput,
  symbol,
  activeColor,
  placeholderColor,
  size = 48,
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
      <Text overpass size={size} weight="heavy" style={{ color: activeColor }}>
        {symbol}
        {formattedWhole}
      </Text>
      {showDecimalSection && (
        <>
          <Text
            overpass
            size={size}
            weight="heavy"
            style={{ color: hasDecimal ? activeColor : placeholderColor }}>
            .
          </Text>
          {decimalPart && (
            <Text overpass size={size} weight="heavy" style={{ color: activeColor }}>
              {decimalPart}
            </Text>
          )}
          {placeholderDecimals && (
            <Text overpass size={size} weight="heavy" style={{ color: placeholderColor }}>
              {placeholderDecimals}
            </Text>
          )}
        </>
      )}
    </HStack>
  );
}

interface CurrencyScreenParams {
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
  selectedMintUrl?: string; // Pre-selected mint URL (for payment requests with single valid mint)
  allowedMints?: string; // JSON array of allowed mint URLs (for payment requests)
}

interface CurrencyScreenProps {
  params: CurrencyScreenParams;
  onMintQuoteCreated: (mintHistoryEntry: MintHistoryEntry) => void;
  onSendTokenCreated: (
    sendHistoryEntry: SendHistoryEntry,
    options?: { nostrSent?: boolean }
  ) => void;
  /** Navigate to MeltQuoteScreen with lnUrlOrAddress and amount - screen handles quote creation */
  onMeltQuoteReady: (lnUrlOrAddress: string, amount: number) => void;
  onCameraPress: (unit: string) => void;
  onReceiveTokenScanned?: (receiveHistoryEntry: ReceiveHistoryEntry) => void;
  onRoutstrSuccess?: () => void;
  /** Called when this modal flow should dismiss back to the previous screen */
  onDone?: () => void;
  processPaymentStringFn?: (scanning: { data: string; type?: string }) => Promise<unknown>;
  /** Called when user tries to send more than current mint's balance */
  onInsufficientBalance?: (amount: number, unit: string) => void;
  /** Emits exact send route mode based on current mint proofs + amount */
  onSendModeChange?: (mode: SendMode | null) => void;
  /** Emits a human-readable debug explanation for the current send route */
  onSendModeDebugChange?: (info: SendModeDebugInfo | null) => void;
}

export function CurrencyScreen({
  params,
  onMintQuoteCreated,
  onSendTokenCreated,
  onMeltQuoteReady,
  onCameraPress,
  onRoutstrSuccess,
  onDone: _onDone,
  processPaymentStringFn,
  onInsufficientBalance,
  onSendModeChange,
  onSendModeDebugChange,
}: CurrencyScreenProps) {
  const [foreground, background, danger] = useThemeColor([
    'foreground',
    'background',
    'danger',
  ] as const);
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  const isCompactPhone = screenHeight <= 760;
  const isVeryCompactPhone = screenHeight <= 680;
  const amountTextSize = isVeryCompactPhone ? 36 : isCompactPhone ? 42 : 48;
  const centerSpacing = isCompactPhone ? 3 : 4;
  const topPadding = insets.top + (isCompactPhone ? 12 : 24);
  const bottomControlsPadding = 0;

  const { send } = useSendWithHistory();
  const { requestLightningInvoice } = useLightningOperations();
  const { sendDirectMessage } = useNostrDirectMessage();
  const { setApiKey, setBalance, balance } = useRoutstrStore();

  // Get user's preferred fiat currency and BTC price
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const mockOffline = useSettingsStore((state) => state.mockOffline);
  const btcPrice = useBtcPrice(displayCurrency);
  const currencyConfig = CURRENCY_CONFIG[displayCurrency];

  // Input mode: 'sats' or 'fiat'
  const [inputMode, setInputMode] = useState<InputMode>('sats');
  // The raw input amount in current mode (sats or fiat cents)
  const [inputAmount, setInputAmount] = useState(params?.amount ? parseFloat(params.amount) : 0);
  // Track raw input string for fiat mode to preserve decimal state
  const [rawFiatInput, setRawFiatInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [offlineSendability, setOfflineSendability] = useState<OfflineSendabilityState | null>(
    null
  );
  const offlineSendabilityRequestIdRef = useRef(0);
  const sendRouteAnalysisRequestIdRef = useRef(0);
  const [sendMode, setSendMode] = useState<SendMode | null>(null);
  const [sendModeDebugInfo, setSendModeDebugInfo] = useState<SendModeDebugInfo | null>(null);
  const { keys } = useNostrKeysContext();
  const selectedMints = useMintStore((state) => state.selectedMints);
  const setSelectedMint = useMintStore((state) => state.setSelectedMint);
  const storeSelectedMint = keys?.pubkey ? selectedMints[keys.pubkey] : undefined;
  const unit = params?.unit?.toLowerCase() || 'sat';

  // Get live balance for the selected mint
  const { balance: liveBalances } = useBalanceContext();
  const { trustedMints } = useMints();

  // Parse allowed mints from params (for payment requests with specified mints)
  const allowedMints = useMemo(() => {
    if (!params.allowedMints) return undefined;
    try {
      return JSON.parse(params.allowedMints) as string[];
    } catch {
      return undefined;
    }
  }, [params.allowedMints]);

  // Determine the effective selected mint
  // If there are allowed mints, check if the current selection is valid
  // If not valid, auto-select the best mint from allowed mints (highest balance)
  const selectedMint = useMemo(() => {
    // If a specific mint was pre-selected (from routing), use it
    if (params.selectedMintUrl) {
      return params.selectedMintUrl;
    }

    // If no allowed mints filter, use the store selection
    if (!allowedMints || allowedMints.length === 0) {
      return storeSelectedMint;
    }

    // Check if current store selection is in allowed mints
    if (storeSelectedMint && allowedMints.includes(storeSelectedMint)) {
      return storeSelectedMint;
    }

    // Current selection is not valid - find the best mint from allowed list
    // Filter to mints we have (trusted) that are in allowed list
    const validMints = trustedMints
      .filter((mint) => allowedMints.includes(mint.mintUrl))
      .map((mint) => ({
        mintUrl: mint.mintUrl,
        balance: liveBalances[mint.mintUrl] || 0,
      }))
      .sort((a, b) => b.balance - a.balance);

    // Return the mint with highest balance, or first available
    return validMints.length > 0 ? validMints[0].mintUrl : storeSelectedMint;
  }, [params.selectedMintUrl, allowedMints, storeSelectedMint, trustedMints, liveBalances]);

  // Auto-update store selection when we override due to allowed mints
  useEffect(() => {
    if (
      keys?.pubkey &&
      selectedMint &&
      storeSelectedMint !== selectedMint &&
      allowedMints?.length
    ) {
      setSelectedMint(keys.pubkey, selectedMint);
    }
  }, [keys?.pubkey, selectedMint, storeSelectedMint, allowedMints, setSelectedMint]);

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
  const fiatMinorUnitAmount = useMemo(
    () => parseFiatInputToMinorUnit(rawFiatInput, inputAmount),
    [inputAmount, rawFiatInput]
  );

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

  const isValidAmount = satsAmount > 0 || !!(params?.paymentRequest && params?.amount);

  const manager = useManager();
  const { isOffline } = useOfflineStatus();

  useEffect(() => {
    const isSendTokenFlow = params.to === 'sendToken';
    if (!isSendTokenFlow || !selectedMint || mintBalance <= 0) {
      setOfflineSendability(null);
      return;
    }

    const requestId = ++offlineSendabilityRequestIdRef.current;
    let cancelled = false;
    setOfflineSendability(null);
    const interaction = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const readyProofs = await manager.proofService.getReadyProofs(selectedMint);
          const index = buildExactOfflineAmountIndex(readyProofs.map((proof) => proof.amount));

          if (cancelled || offlineSendabilityRequestIdRef.current !== requestId) {
            return;
          }

          setOfflineSendability({
            reachableSums: index.reachableSums,
            reachableAmounts: new Set(index.reachableSums),
            totalReadyBalance: index.totalReadyBalance,
          });
        } catch {
          if (!cancelled && offlineSendabilityRequestIdRef.current === requestId) {
            setOfflineSendability(null);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      interaction.cancel();
    };
  }, [manager, mintBalance, params.to, selectedMint]);

  useEffect(() => {
    const isSendTokenFlow = params.to === 'sendToken';

    if (!isSendTokenFlow) {
      setSendMode(null);
      setSendModeDebugInfo(null);
      return;
    }

    if (!selectedMint || !Number.isFinite(amount) || amount <= 0) {
      setSendMode(null);
      setSendModeDebugInfo({
        title: 'Checking route',
        message: 'Enter an amount to analyze whether this send can be completed offline.',
      });
      return;
    }

    if (amount > mintBalance) {
      setSendMode(null);
      setSendModeDebugInfo({
        title: 'Insufficient balance',
        message: `This send needs ${formatSatsAmount(amount)} but the selected mint only has ${formatSatsAmount(mintBalance)} available.`,
      });
      return;
    }

    if (!offlineSendability) {
      setSendMode(null);
      setSendModeDebugInfo({
        title: 'Checking route',
        message:
          'The wallet is building the offline exact-amount index from your ready proofs for the selected mint.',
      });
      return;
    }

    if (offlineSendability.totalReadyBalance < amount) {
      setSendMode(null);
      setSendModeDebugInfo({
        title: 'Not enough ready proofs',
        message: `Your ready proofs sum to ${formatSatsAmount(offlineSendability.totalReadyBalance)}, which is below the requested ${formatSatsAmount(amount)}.`,
      });
      return;
    }

    const requestId = ++sendRouteAnalysisRequestIdRef.current;
    let cancelled = false;
    setSendMode(null);

    const debounceTimer = setTimeout(() => {
    void (async () => {
      if (inputMode === 'fiat' && fiatMinorUnitAmount != null && btcPrice) {
        const requestedFiatLabel = formatFiatMinorUnit(fiatMinorUnitAmount, currencyConfig.symbol);
        const sameDisplayRange = getSatRangeForDisplayedFiatMinorUnit(
          fiatMinorUnitAmount,
          btcPrice
        );
        const sameDisplayCandidates = sameDisplayRange
          ? offlineSendability.reachableSums.filter(
              (candidate) =>
                candidate >= sameDisplayRange.minSat && candidate <= sameDisplayRange.maxSat
            )
          : [];
        const sameDisplaySearchOrder = orderCandidatesByCloseness(sameDisplayCandidates, amount);
        const fiatSuggestions = await getOfflineFiatSendSuggestions(
          manager.proofService,
          selectedMint,
          amount,
          fiatMinorUnitAmount,
          btcPrice
        );

        if (cancelled || sendRouteAnalysisRequestIdRef.current !== requestId) {
          return;
        }

        const lines: string[] = [
          `${requestedFiatLabel} currently converts to about ${formatSatsAmount(amount)}.`,
        ];

        if (sameDisplayRange) {
          lines.push(
            `${requestedFiatLabel} stays the same for any amount from ${formatSatsAmount(sameDisplayRange.minSat)} to ${formatSatsAmount(sameDisplayRange.maxSat)} because those sats all round to the same fiat display.`
          );
        }

        if (sameDisplayCandidates.length > 0) {
          lines.push(
            `Exact offline amounts already constructible from your ready proofs in that same-price window: ${formatAmountList(
              sameDisplayCandidates,
              formatSatsAmount
            )}.`
          );
          lines.push(
            `Nearest-first search inside that window: ${formatAmountList(
              sameDisplaySearchOrder,
              formatSatsAmount
            )}.`
          );
        } else {
          lines.push(
            'There are no exact offline amounts from your current proofs inside that same-price window.'
          );
        }

        if (offlineSendability.reachableAmounts.has(amount)) {
          lines.push(
            `${formatSatsAmount(amount)} is already exact, so it can be sent offline as entered.`
          );
        } else {
          lines.push(
            `${formatSatsAmount(amount)} can't be sent offline exactly, so the wallet looks for the nearest exact amount that still displays as ${requestedFiatLabel}.`
          );
        }

        if (fiatSuggestions.autoSelectAmount != null) {
          lines.push(
            `First match found: ${formatSatsAmount(fiatSuggestions.autoSelectAmount)}. It still displays as ${requestedFiatLabel}, so the header shows offline-spendable.`
          );
          setSendMode('offline');
          setSendModeDebugInfo({
            title: 'Offline sendable',
            message: lines.join('\n\n'),
          });
          return;
        }

        lines.push(
          `No exact offline amount was found that still displays as ${requestedFiatLabel}.`
        );

        for (let step = 1; step <= 5; step += 1) {
          const lowerMinorUnit = fiatMinorUnitAmount - step;
          const upperMinorUnit = fiatMinorUnitAmount + step;

          if (lowerMinorUnit >= 0) {
            const lowerRange = getSatRangeForDisplayedFiatMinorUnit(lowerMinorUnit, btcPrice);
            if (lowerRange) {
              const lowerCandidates = offlineSendability.reachableSums.filter(
                (candidate) => candidate >= lowerRange.minSat && candidate <= lowerRange.maxSat
              );
              lines.push(
                `${formatFiatMinorUnit(lowerMinorUnit, currencyConfig.symbol)} would search ${formatSatsAmount(lowerRange.minSat)} to ${formatSatsAmount(lowerRange.maxSat)}. Exact offline amounts there: ${formatAmountList(
                  lowerCandidates,
                  formatSatsAmount
                )}.`
              );
            }
          }

          const upperRange = getSatRangeForDisplayedFiatMinorUnit(upperMinorUnit, btcPrice);
          if (upperRange) {
            const upperCandidates = offlineSendability.reachableSums.filter(
              (candidate) => candidate >= upperRange.minSat && candidate <= upperRange.maxSat
            );
            lines.push(
              `${formatFiatMinorUnit(upperMinorUnit, currencyConfig.symbol)} would search ${formatSatsAmount(upperRange.minSat)} to ${formatSatsAmount(upperRange.maxSat)}. Exact offline amounts there: ${formatAmountList(
                upperCandidates,
                formatSatsAmount
              )}.`
            );
          }

          if (
            (fiatSuggestions.roundDownOption &&
              fiatSuggestions.roundDownOption.displayMinorUnit === lowerMinorUnit) ||
            (fiatSuggestions.roundUpOption &&
              fiatSuggestions.roundUpOption.displayMinorUnit === upperMinorUnit)
          ) {
            break;
          }
        }

        if (fiatSuggestions.roundDownOption || fiatSuggestions.roundUpOption) {
          const fallbackOptions = [
            fiatSuggestions.roundDownOption
              ? `${formatFiatMinorUnit(
                  fiatSuggestions.roundDownOption.displayMinorUnit,
                  currencyConfig.symbol
                )} -> ${formatSatsAmount(fiatSuggestions.roundDownOption.amount)}`
              : null,
            fiatSuggestions.roundUpOption
              ? `${formatFiatMinorUnit(
                  fiatSuggestions.roundUpOption.displayMinorUnit,
                  currencyConfig.symbol
                )} -> ${formatSatsAmount(fiatSuggestions.roundUpOption.amount)}`
              : null,
          ].filter(Boolean);

          lines.push(
            `That is why the header shows rounding required. The first wider-range exact options are ${fallbackOptions.join(' or ')}.`
          );
        } else {
          lines.push(
            'No exact offline fallback was found in the current debug search range, so this send would need an online swap.'
          );
        }

        setSendMode('online');
        setSendModeDebugInfo({
          title: 'Offline round required',
          message: lines.join('\n\n'),
        });
        return;
      }

      const suggestions = await getOfflineSendSuggestions(
        manager.proofService,
        selectedMint,
        amount
      );

      if (cancelled || sendRouteAnalysisRequestIdRef.current !== requestId) {
        return;
      }

      const nearbyReachableAmounts = orderCandidatesByCloseness(
        offlineSendability.reachableSums.filter(
          (candidate) => Math.abs(candidate - amount) <= Math.max(25, Math.ceil(amount * 0.1))
        ),
        amount
      );

      const lines: string[] = [
        `Requested amount: ${formatSatsAmount(amount)}.`,
        `Exact offline amounts already constructible near this value: ${formatAmountList(
          nearbyReachableAmounts,
          formatSatsAmount
        )}.`,
      ];

      if (suggestions.isRequestedAmountSendableOffline) {
        lines.push(`${formatSatsAmount(amount)} is exact, so it can be sent offline as entered.`);
        setSendMode('offline');
        setSendModeDebugInfo({
          title: 'Offline sendable',
          message: lines.join('\n\n'),
        });
        return;
      }

      lines.push(
        `${formatSatsAmount(amount)} can't be sent offline exactly. The closest validated exact amounts are ${
          suggestions.roundDownAmount
            ? formatSatsAmount(suggestions.roundDownAmount)
            : 'no lower match'
        } and ${
          suggestions.roundUpAmount
            ? formatSatsAmount(suggestions.roundUpAmount)
            : 'no higher match'
        }.`
      );

      setSendMode('online');
      setSendModeDebugInfo({
        title: 'Offline round required',
        message: lines.join('\n\n'),
      });
    })();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [
    amount,
    btcPrice,
    currencyConfig.symbol,
    fiatMinorUnitAmount,
    inputMode,
    manager.proofService,
    mintBalance,
    mockOffline,
    offlineSendability,
    params.to,
    selectedMint,
  ]);

  useEffect(() => {
    onSendModeChange?.(params.to === 'sendToken' ? sendMode : null);
  }, [onSendModeChange, params.to, sendMode]);

  useEffect(() => {
    onSendModeDebugChange?.(params.to === 'sendToken' ? sendModeDebugInfo : null);
  }, [onSendModeDebugChange, params.to, sendModeDebugInfo]);

  const handleLightningReceive = async () => {
    if (!selectedMint) {
      noMintSelectedPopup();
      return;
    }

    const mintQuote = await requestLightningInvoice(selectedMint, amount);

    const mintHistoryEntry = await manager.history
      .getPaginatedHistory()
      .then((h) => h.find((h) => h.type === 'mint' && h.quoteId === mintQuote.quote));

    if (mintHistoryEntry) {
      // Capture and store location (respects settings toggle and permissions)
      await captureAndStoreLocation(mintHistoryEntry.id);
      onMintQuoteCreated(mintHistoryEntry as MintHistoryEntry);
    }
  };

  const handleEcashSend = useCallback(
    async (sendAmount: number) => {
      if (!selectedMint) {
        noMintSelectedPopup();
        return;
      }

      // useSendWithHistory returns both the token and the history entry
      const { token, historyEntry } = await send(selectedMint, sendAmount, {});

      // Capture and store location (respects settings toggle and permissions)
      await captureAndStoreLocation(historyEntry.id);

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
            routstrTopUpSuccessPopup({
              balance: `${(balance ? balance + topUpResult.added_amount : topUpResult.added_amount / 1000).toFixed(0)} sats`,
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
              routstrWalletCreatedPopup({
                balance: `${(walletResponse.balance / 1000).toFixed(0)} sats`,
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

              routstrInitializedPopup({
                balance: `${(balanceData.balance / 1000).toFixed(0)} sats`,
              });
            } catch (balanceError) {
              console.error('Failed to check balance:', balanceError);
              // Still store the token as API key - it may work for subsequent requests
              setApiKey(encodedToken);
              routstrInitializedPopup();
            }
            onRoutstrSuccess?.();
            return;
          }
        } catch (error: any) {
          console.error('Failed to handle Routstr top-up:', error);
          routstrTransactionFailedPopup({ text: error.error?.message });
        }
      }

      onSendTokenCreated({ ...historyEntry, token });
    },
    [
      balance,
      onRoutstrSuccess,
      onSendTokenCreated,
      params.routstrTopUp,
      selectedMint,
      send,
      setApiKey,
      setBalance,
    ]
  );

  const handleRoundedOfflineSend = useCallback(
    async (sendAmount: number) => {
      setLoading(true);
      try {
        await handleEcashSend(sendAmount);
      } finally {
        setLoading(false);
      }
    },
    [handleEcashSend]
  );

  const maybeShowOfflineSendSuggestions = useCallback(async () => {
    if (
      !isOffline ||
      params.to !== 'sendToken' ||
      !selectedMint ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return false;
    }

    if (inputMode === 'fiat' && fiatMinorUnitAmount != null && btcPrice) {
      const fiatSuggestions = await getOfflineFiatSendSuggestions(
        manager.proofService,
        selectedMint,
        amount,
        fiatMinorUnitAmount,
        btcPrice
      );

      if (fiatSuggestions.autoSelectAmount != null) {
        await handleRoundedOfflineSend(fiatSuggestions.autoSelectAmount);
        return true;
      }

      if (fiatSuggestions.roundDownOption || fiatSuggestions.roundUpOption) {
        offlineSendSuggestionsPopup({
          requestedAmount: amount,
          roundDownAmount: fiatSuggestions.roundDownOption?.amount ?? null,
          roundDownLabel: fiatSuggestions.roundDownOption
            ? formatFiatMinorUnit(
                fiatSuggestions.roundDownOption.displayMinorUnit,
                currencyConfig.symbol
              )
            : undefined,
          roundUpAmount: fiatSuggestions.roundUpOption?.amount ?? null,
          roundUpLabel: fiatSuggestions.roundUpOption
            ? formatFiatMinorUnit(
                fiatSuggestions.roundUpOption.displayMinorUnit,
                currencyConfig.symbol
              )
            : undefined,
          unit: 'sat',
          onSelectAmount: handleRoundedOfflineSend,
        });

        return true;
      }

      return false;
    }

    const suggestions = await getOfflineSendSuggestions(manager.proofService, selectedMint, amount);
    if (suggestions.isRequestedAmountSendableOffline) {
      return false;
    }

    offlineSendSuggestionsPopup({
      requestedAmount: amount,
      roundDownAmount: suggestions.roundDownAmount,
      roundUpAmount: suggestions.roundUpAmount,
      unit: 'sat',
      onSelectAmount: handleRoundedOfflineSend,
    });

    return true;
  }, [
    amount,
    btcPrice,
    currencyConfig.symbol,
    fiatMinorUnitAmount,
    handleRoundedOfflineSend,
    inputMode,
    isOffline,
    manager.proofService,
    params.to,
    selectedMint,
  ]);

  const handleNext = async () => {
    if (!isValidAmount) return;

    // Check for insufficient balance on send operations
    const isSendOperation =
      params.to === 'sendToken' || params.to === 'meltQuote' || params.to === 'paymentRequest';
    if (isSendOperation && amount > mintBalance) {
      // Redirect to mint selection with minimum amount filter
      if (onInsufficientBalance) {
        onInsufficientBalance(amount, unit);
        return;
      }
    }

    if (params.to === 'sendToken' && mockOffline) {
      setLoading(true);
      try {
        const didShowOfflineSuggestions = await maybeShowOfflineSendSuggestions();
        if (didShowOfflineSuggestions) {
          return;
        }
      } finally {
        setLoading(false);
      }
    }

    if (params.to === 'sendToken' && isOffline && !mockOffline) {
      setLoading(true);
      try {
        const didShowOfflineSuggestions = await maybeShowOfflineSendSuggestions();
        if (didShowOfflineSuggestions) {
          return;
        }
      } finally {
        setLoading(false);
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
          await handleEcashSend(amount);
        } finally {
          setLoading(false);
        }
        break;
      case 'meltQuote':
        // Navigate to MeltQuoteScreen with lnUrlOrAddress and amount
        // The screen will handle LNURL resolution and quote creation
        if (!params.lnUrlOrAddress) {
          noLightningAddressPopup();
          setLoading(false);
          return;
        }

        onMeltQuoteReady(params.lnUrlOrAddress, amount);
        setLoading(false);
        break;
      case 'paymentRequest':
        // Handle NUT-18 payment request: create token, send via Nostr, navigate to SendTokenScreen
        if (!params.paymentRequest) {
          noPaymentRequestPopup();
          setLoading(false);
          return;
        }

        try {
          // 1. Decode the payment request
          const decodedRequest = decodePaymentRequest(params.paymentRequest);
          const nostrTransport = decodedRequest.transport?.find(
            (t) => t.type === PaymentRequestTransportType.NOSTR
          );

          if (!nostrTransport?.target) {
            invalidNostrTransportPopup();
            setLoading(false);
            return;
          }

          // Decode nprofile to get pubkey and relays
          const decoded = nip19.decode(nostrTransport.target);
          if ((decoded.type as string) !== 'nprofile') {
            invalidRecipientPopup();
            setLoading(false);
            return;
          }
          const recipientData = decoded.data as unknown as ProfilePointer;

          // 2. Determine mint to use
          const mintToUse = params.selectedMintUrl || selectedMint;
          if (!mintToUse) {
            noMintSelectedPopup();
            setLoading(false);
            return;
          }

          // 3. Create ecash token
          const { token, historyEntry } = await send(mintToUse, amount);

          // 4. Build PaymentRequestPayload
          const payload: PaymentRequestPayload = {
            id: decodedRequest.id,
            mint: mintToUse,
            unit: decodedRequest.unit || 'sat',
            proofs: token.proofs,
          };

          // 5. Send via NIP-17 direct message
          await sendDirectMessage(nostrTransport.target, JSON.stringify(payload), {
            additionalRelays: recipientData.relays || [],
          });

          // 6. Capture location for the transaction
          await captureAndStoreLocation(historyEntry.id);

          // 7. Show payment-request status and navigate to SendTokenScreen
          usePaymentStatusStore.getState().setActive({
            variant: 'payment-request',
            id: historyEntry.operationId,
            mintUrl: mintToUse,
            amount,
            unit: decodedRequest.unit || 'sat',
            state: 'processing',
          });
          paymentStatusPopup({
            variant: 'payment-request',
            id: historyEntry.operationId,
            mintUrl: mintToUse,
            amount,
            unit: decodedRequest.unit || 'sat',
          });

          // Navigate to SendTokenScreen with the history entry + token
          // Pass nostrSent: true so it shows the payment request timeline
          onSendTokenCreated({ ...historyEntry, token }, { nostrSent: true });
        } catch (err) {
          console.error('[CurrencyScreen] Failed to send payment request:', err);
          sendPaymentFailedPopup({ text: err instanceof Error ? err.message : undefined });
        } finally {
          setLoading(false);
        }
        break;
      default:
        setLoading(false);
        break;
    }
  };

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

  const renderButtons = () => {
    const isEcashSend = params.to === 'sendToken';
    const hasPaymentRequest = params?.paymentRequest;
    // NUT-18 payment request flow uses `to: 'paymentRequest'` and `allowedMints`
    const isNut18PaymentRequest = params.to === 'paymentRequest' && hasPaymentRequest;
    // Legacy payment request flow uses `mints` and `allowedUnits` params
    const isLegacyPaymentRequest = hasPaymentRequest && params?.mints && params?.allowedUnits;

    // Determine button disabled state
    const getNextButtonDisabled = () => {
      if (isNut18PaymentRequest) {
        // For NUT-18 payment requests, just check valid amount
        // Mint validation is handled via auto-selection earlier
        return !isValidAmount;
      }
      if (isLegacyPaymentRequest) {
        // Legacy flow: check amount, mint, and unit
        return !(
          isValidAmount &&
          (params?.mints as unknown as string[])?.includes(selectedMint || '') &&
          (params?.allowedUnits as unknown as string[])?.includes(unit.toUpperCase() || '')
        );
      }
      // Default: just check valid amount
      return !isValidAmount;
    };

    return (
      <HStack justify="center" align="center">
        {!params?.amount && isEcashSend && !hasPaymentRequest && <Text></Text>}
        <ButtonHandler
          buttons={[
            {
              text: 'Paste',
              icon: 'lets-icons:copy',
              variant: 'secondary',
              onPress: handlePastePress,
              condition: isEcashSend && !hasPaymentRequest && !!processPaymentStringFn,
            },
            {
              text: 'Next',
              ...(isEcashSend && { icon: 'lucide:arrow-right' }),
              variant: 'primary',
              onPress: handleNext,
              loading: loading,
              disabled: getNextButtonDisabled(),
            },
            {
              text: 'Scan QR',
              icon: 'stash:qr-code',
              variant: 'secondary',
              onPress: async () => onCameraPress(unit),
              condition: isEcashSend && !hasPaymentRequest,
            },
          ]}
        />
      </HStack>
    );
  };

  // Get the unit to pass to keyboard based on input mode
  const keyboardUnit = inputMode === 'sats' ? 'sat' : displayCurrency;

  // Keyboard value synced externally (critical for fiat/sats toggle)
  const keyboardValue = useMemo(() => {
    if (inputMode === 'fiat') return rawFiatInput;
    return inputAmount > 0 ? String(inputAmount) : '';
  }, [inputMode, inputAmount, rawFiatInput]);

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
    <View style={{ flex: 1, backgroundColor: background }}>
      <View style={{ flex: 1, paddingTop: topPadding, paddingHorizontal: 16 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <VStack align="center" spacing={centerSpacing}>
            {/* Main amount display */}
            {inputMode === 'sats' ? (
              <AmountFormatter
                amount={inputAmount}
                unit={unit}
                size={amountTextSize}
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
                size={amountTextSize}
                activeColor={
                  rawFiatInput
                    ? params?.to === 'sendToken' || params?.to === 'meltQuote'
                      ? danger
                      : foreground
                    : opacity(foreground, 0.4)
                }
                placeholderColor={opacity(
                  params?.to === 'sendToken' || params?.to === 'meltQuote' ? danger : foreground,
                  0.35
                )}
              />
            )}
            {/* Secondary converted value with toggle */}
            <FiatCurrencyPill
              displayText={
                secondaryDisplay ||
                (inputMode === 'sats' ? `≈ ${currencyConfig.symbol}0.00` : '≈ 0 sats')
              }
              onPress={handleToggleInputMode}
              showToggleGlyph
              enableCurrencyMenu={false}
            />
          </VStack>
        </View>
      </View>

      <BottomButtons style={{ position: 'relative' }} paddingBottom={bottomControlsPadding}>
        {!params?.amount && (
          <CustomKeyboard
            loading={loading}
            unit={keyboardUnit}
            compact={isCompactPhone}
            value={keyboardValue}
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
