import React, { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import type { GlassVariant } from 'liquid-glass-text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useSettingsStore, DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { TouchableOpacity } from '@/shared/ui/primitives/TouchableOpacity';
import { FiatCurrencyPill } from '@/features/wallet/components/FiatCurrencyPill';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useAppBalance } from '@/features/wallet/hooks/useAppBalance';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { liquidGlassModifiers, supportsLiquidGlass } from '@/shared/lib/version';
import { useRouter } from 'expo-router';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { reservedProofsFreedPopup, reservedProofsFailedPopup } from '@/shared/lib/popup';
import { usePaginatedHistory } from '@cashu/coco-react';
import type { SendHistoryEntry } from '@cashu/coco-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useReservedProofs } from '@/shared/hooks/useReservedProofs';
import { walletLog, Log } from '@/shared/lib/logger';

interface Account {
  unit: CurrencyUnit;
}

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type DisplayBtcMode = 0 | 1 | 2 | 3;

interface PrimaryBalanceProps {
  account: Account;
}

// Currency display configuration
const CURRENCY_CONFIG: Record<DisplayCurrency, { symbol: string; label: string }> = {
  usd: { symbol: '$', label: 'USD' },
  eur: { symbol: '€', label: 'EUR' },
  gbp: { symbol: '£', label: 'GBP' },
};

// Liquid-glass balance rendering: flip to `'clear'` for the fully transparent
// variant (edge highlight only, refraction through the background). The
// `'regular'` frosted material is what ships by default — matches the glass
// config used by our Split Bill / Receive buttons
// (`variant: 'regular', interactive`).
const LIQUID_GLASS_BALANCE_VARIANT: GlassVariant = 'clear';

// Alpha applied to the theme foreground to produce the glass tint. Using the
// foreground (same colour as the Send/Receive/Pending pill labels) keeps the
// balance visually part of the same text layer across themes; the 0.5 alpha
// lets the frosted refraction/specular come through. `opacity()` emits
// `#RRGGBBAA` and the native module parses the alpha channel
// (see LiquidGlassTextView.color(hex:)).
const LIQUID_GLASS_BALANCE_TINT_ALPHA = 0.75;

// Tap target for the balance. Explicit dimensions are necessary because:
//   1. The parent VStack uses `align="center"` → children shrink to content.
//   2. The native liquid-glass view sizes to intrinsic glyph bounds — the
//      tight path around the digits — so a TouchableOpacity that hugs it
//      only fires on taps that land on the rendered glyph pixels.
// Stretching the touchable to fill the row and giving it a comfortable min
// height makes the whole balance area tap-to-cycle-unit again, matching
// the old behaviour before we switched to liquid glass.
const BALANCE_TAP_HEIGHT = 48;

// ---------------------------------------------------------------------------
// Shared ecash status pill (pending / reserved / etc.)
// ---------------------------------------------------------------------------

const PILL_TEXT_SIZE = 11;
const PILL_IOS_HEIGHT = 30;

interface EcashStatusPillProps {
  label: string;
  totalAmount: number;
  unit: string;
  sfSymbol: React.ComponentProps<typeof SwiftUIImage>['systemName'];
  tintColor?: string;
  onPress?: () => void;
}

function EcashStatusPill({
  label,
  totalAmount,
  unit,
  sfSymbol,
  tintColor,
  onPress,
}: EcashStatusPillProps): React.ReactElement | null {
  const [foreground] = useThemeColor(['foreground'] as const);
  const tint = tintColor ?? foreground;

  if (totalAmount <= 0) return null;

  const text = `${label}: ${totalAmount.toLocaleString()} ${unit.toUpperCase()}`;
  const iosWidth = Math.max(72, Math.round(text.length * (PILL_TEXT_SIZE * 0.62) + 28 + 17));

  if (Platform.OS === 'ios' && supportsLiquidGlass()) {
    return (
      <Host matchContents>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            frame({ height: PILL_IOS_HEIGHT, width: iosWidth, alignment: 'center' }),
            ...liquidGlassModifiers(
              glassEffect({
                shape: 'capsule',
                glass: { tint: opacity(tint, 0.15), variant: 'regular', interactive: false },
              })
            ),
          ]}>
          <SwiftUIHStack
            alignment="center"
            spacing={5}
            modifiers={[frame({ width: iosWidth, alignment: 'center' })]}>
            <SwiftUIImage systemName={sfSymbol} size={12} color={opacity(tint, 0.85)} />
            <SwiftUIText
              modifiers={[
                font({ size: PILL_TEXT_SIZE, design: 'monospaced', weight: 'bold' }),
                foregroundStyle(opacity(tint, 0.85)),
              ]}>
              {text}
            </SwiftUIText>
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    );
  }

  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={0.9}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          backgroundColor: tintColor ? opacity(tint, 0.3) : opacity(foreground, 0.08),
          borderWidth: 1,
          borderColor: tintColor ? opacity(tint, 0.3) : opacity(foreground, 0.12),
          paddingHorizontal: 12,
          paddingVertical: 5,
        }}>
        <Icon name="majesticons:coins" size={14} color={opacity(tint, 0.8)} />
        <UntranslatedText
          overpass
          bold
          size={PILL_TEXT_SIZE}
          color={opacity(tint, 0.8)}
          style={{ letterSpacing: 0.5 }}>
          {text}
        </UntranslatedText>
      </HStack>
    </TouchableOpacity>
  );
}

/**
 * Component that displays the primary balance with unit toggling capability
 */
export function PrimaryBalance({ account }: PrimaryBalanceProps): React.ReactElement {
  const router = useRouter();
  const { history } = usePaginatedHistory();
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());
  const setDisplayBtc = useSettingsStore((state) => state.setDisplayBtc);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const mockMode = useSettingsStore((state) => state.mockMode);
  const mockPendingAmount = useMockDataStore((state) => state.mockPendingAmount);
  const balance = useAppBalance();
  const btcPrice = useBtcPrice(displayCurrency);

  const toggleUnit = useCallback(async () => {
    await EnhancedHaptics.successHaptic();
    setDisplayBtc(((displayBtc + 1) % 4) as DisplayBtcMode);
  }, [displayBtc, setDisplayBtc]);

  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const fiatValue = btcPrice ? ((btcPrice / 100_000_000) * balance).toFixed(2) : '0.00';
  const [foreground, warning] = useThemeColor(['foreground', 'warning'] as const);
  const balanceTint = opacity(foreground, LIQUID_GLASS_BALANCE_TINT_ALPHA);
  const { reservedTotal } = useReservedProofs();
  const pendingSends = history.filter(
    (entry): entry is SendHistoryEntry =>
      entry.type === 'send' && (entry.state === 'pending' || entry.state === 'prepared')
  );
  const pendingTotal = mockMode
    ? mockPendingAmount
    : pendingSends.reduce((sum, tx) => sum + tx.amount, 0);
  const pendingUnit = pendingSends[0]?.unit || 'sat';

  const displayText = `≈ ${currencyConfig.symbol}${fiatValue}`;
  const handlePendingPress = useCallback(() => {
    router.navigate({
      pathname: '/transactions',
      params: {
        account: JSON.stringify(account),
        filterCurrency: account.unit,
        filterPaymentType: 'ecash',
        filterDirection: 'outgoing',
        filterStatus: 'Pending',
        filterMintUrl: 'all',
      },
    });
  }, [router, account]);

  const handleReservedPress = useCallback(() => {
    const recoverPending = async () => {
      walletLog.info('wallet.reserved.recovery_start', { reservedTotal });
      try {
        const manager = CocoManager.getInstance();

        await manager.ops.send.recovery.run();
        await manager.ops.melt.recovery.run();
        walletLog.info('wallet.reserved.recovery_complete');
        reservedProofsFreedPopup({
          text:
            'Recovery completed.\n' +
            'Checked pending send and melt operations.\n' +
            'If reserved balance is still stuck, use force cleanup.',
        });
      } catch (error) {
        walletLog.error('wallet.reserved.recovery_failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        reservedProofsFailedPopup({
          text: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    Alert.alert('Reserved Proofs', 'Choose a recovery action.', [
      { text: 'Close', style: 'cancel' },
      { text: 'Recover Pending Operations', onPress: recoverPending },
    ]);
  }, []);

  return (
    <Log name="PrimaryBalance">
      <VStack align="center" gap={8} className="z-9">
        <FiatCurrencyPill displayText={displayText} textSize={12} />
        <TouchableOpacity
          onPress={toggleUnit}
          style={{
            alignSelf: 'stretch',
            height: BALANCE_TAP_HEIGHT,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AmountFormatter
            amount={balance}
            unit={account.unit}
            weight="heavy"
            liquid
            glassVariant={LIQUID_GLASS_BALANCE_VARIANT}
            color={balanceTint}
          />
        </TouchableOpacity>
        <EcashStatusPill
          label="PENDING"
          totalAmount={pendingTotal}
          unit={pendingUnit}
          sfSymbol="clock.arrow.trianglehead.counterclockwise.rotate.90"
          onPress={handlePendingPress}
        />
        <EcashStatusPill
          label="RESERVED"
          totalAmount={reservedTotal}
          unit="sat"
          sfSymbol="lock.fill"
          tintColor={warning}
          onPress={handleReservedPress}
        />
      </VStack>
    </Log>
  );
}
