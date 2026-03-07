import React, { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
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
import { usePaginatedHistory } from 'coco-cashu-react';
import type { SendHistoryEntry } from 'coco-cashu-core';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { useReservedProofs } from '@/shared/hooks/useReservedProofs';

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
  const warning = useThemeColor('warning');
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
      try {
        const manager = CocoManager.getInstance();
        await manager.recoverPendingSendOperations();
        await manager.recoverPendingMeltOperations();
        reservedProofsFreedPopup({
          text:
            'Recovery completed.\n' +
            'Checked pending send and melt operations.\n' +
            'If reserved balance is still stuck, use force cleanup.',
        });
      } catch (error) {
        reservedProofsFailedPopup({
          text: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    const forceFreeAll = async () => {
      try {
        const result = await CocoManager.freeAllReservedProofs();
        reservedProofsFreedPopup({
          text:
            `Reserved proofs found: ${result.totalReservedProofs}\n` +
            `Rolled back send ops: ${result.rolledBackSendOperations}\n` +
            `Rolled back melt ops: ${result.rolledBackMeltOperations}\n` +
            `Orphaned reservations released: ${result.releasedOrphanedReservations}\n` +
            `Errors: ${result.errors.length}`,
        });
      } catch (error) {
        reservedProofsFailedPopup({
          text: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    Alert.alert('Reserved Proofs', 'Choose a recovery action.', [
      { text: 'Close', style: 'cancel' },
      { text: 'Recover Pending Operations', onPress: recoverPending },
      {
        text: 'Force Free All Reserved Proofs',
        style: 'destructive',
        onPress: forceFreeAll,
      },
    ]);
  }, []);

  return (
    <VStack align="center" gap={8} className="z-9">
      <FiatCurrencyPill displayText={displayText} textSize={12} />
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
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
  );
}
