import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { VStack } from 'components/ui/View/VStack';
import { HStack } from 'components/ui/View/HStack';
import { useSettingsStore, DisplayCurrency } from 'stores/settingsStore';
import { EnhancedHaptics } from 'components/ui/Haptics';
import { AmountFormatter } from 'components/ui/AmountFormatter';
import { UntranslatedText } from 'components/ui/Text';
import { useBtcPrice } from 'stores/pricelistStore';
import { TouchableOpacity } from 'components/ui/TouchableOpacity';
import { FiatCurrencyPill } from 'components/blocks/FiatCurrencyPill';
import { useTheme } from 'providers/ThemeProvider';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useAppBalance } from 'hooks/useAppBalance';
import { useMockDataStore } from 'stores/mockDataStore';
import {
  Host,
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  Text as SwiftUIText,
} from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, glassEffect } from '@expo/ui/swift-ui/modifiers';
import { supportsLiquidGlass } from '@/helper/version';
import { useRouter } from 'expo-router';
import { CocoManager } from '@/helper/coco/manager';
import { popup } from '@/helper/popup';
import { useBalanceContext, useManager, usePaginatedHistory } from 'coco-cashu-react';
import type { CoreProof, SendHistoryEntry } from 'coco-cashu-core';

interface Account {
  unit: CurrencyUnit;
}

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type DisplayBtcMode = 0 | 1 | 2 | 3;

interface PrimaryBalanceProps {
  account: Account;
}

type UnsafeManager = {
  proofRepository?: {
    getReservedProofs?: () => Promise<CoreProof[]>;
  };
};

// Currency display configuration
const CURRENCY_CONFIG: Record<DisplayCurrency, { symbol: string; label: string }> = {
  usd: { symbol: '$', label: 'USD' },
  eur: { symbol: '€', label: 'EUR' },
  gbp: { symbol: '£', label: 'GBP' },
};

// ---------------------------------------------------------------------------
// Pending outgoing ecash pill – shows total unclaimed send tokens
// ---------------------------------------------------------------------------

interface PendingEcashPillProps {
  totalAmount: number;
  unit: string;
  onPress?: () => void;
}

function PendingEcashPill({
  totalAmount,
  unit,
  onPress,
}: PendingEcashPillProps): React.ReactElement | null {
  const { getPrimaryColor } = useTheme();

  if (totalAmount <= 0) return null;

  const formatted = totalAmount.toLocaleString();
  const text = `PENDING: ${formatted} ${unit.toUpperCase()}`;
  const textSize = 11;
  const iosHeight = 30;
  // Match FiatCurrencyPill width calculation: monospace char width ~0.62em + padding + icon (12) + spacing (5).
  const iosWidth = Math.max(72, Math.round(text.length * (textSize * 0.62) + 28 + 17));

  // iOS 26+ liquid glass – mirrors FiatCurrencyPill's glass capsule with an
  // SF Symbol icon, laid out like the Send/Receive LiquidCapsuleButton.
  if (Platform.OS === 'ios' && supportsLiquidGlass()) {
    return (
      <Host matchContents>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
            glassEffect({
              shape: 'capsule',
              glass: {
                tint: opacity(getPrimaryColor('500'), 0.15),
                variant: 'regular',
                interactive: false,
              },
            }),
          ]}>
          <SwiftUIHStack
            alignment="center"
            spacing={5}
            modifiers={[frame({ width: iosWidth, alignment: 'center' })]}>
            <SwiftUIImage
              systemName="clock.arrow.trianglehead.counterclockwise.rotate.90"
              size={12}
              color={opacity(getPrimaryColor('0'), 0.75)}
            />
            <SwiftUIText
              modifiers={[
                font({ size: textSize, design: 'monospaced', weight: 'bold' }),
                foregroundStyle(opacity(getPrimaryColor('0'), 0.75)),
              ]}>
              {text}
            </SwiftUIText>
          </SwiftUIHStack>
        </SwiftUIButton>
      </Host>
    );
  }

  // Fallback (iOS <26 / Android) – current design with increased opacity.
  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress} activeOpacity={0.9}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          backgroundColor: opacity(getPrimaryColor('500'), 0.3),
          borderWidth: 1,
          borderColor: opacity(getPrimaryColor('400'), 0.3),
          paddingHorizontal: 12,
          paddingVertical: 5,
        }}>
        <Icon name="majesticons:coins" size={14} color={opacity(getPrimaryColor('0'), 0.66)} />
        <UntranslatedText
          bold
          size={11}
          color={opacity(getPrimaryColor('0'), 0.66)}
          style={{ letterSpacing: 0.5 }}>
          {text}
        </UntranslatedText>
      </HStack>
    </TouchableOpacity>
  );
}

interface ReservedEcashPillProps {
  totalAmount: number;
  unit: string;
  onPress?: () => void;
}

function ReservedEcashPill({
  totalAmount,
  unit,
  onPress,
}: ReservedEcashPillProps): React.ReactElement | null {
  const { getPrimaryColor } = useTheme();

  if (totalAmount <= 0) return null;

  const formatted = totalAmount.toLocaleString();
  const text = `RESERVED: ${formatted} ${unit.toUpperCase()}`;
  const textSize = 11;
  const iosHeight = 30;
  const iosWidth = Math.max(72, Math.round(text.length * (textSize * 0.62) + 28 + 17));

  if (Platform.OS === 'ios' && supportsLiquidGlass()) {
    return (
      <Host matchContents>
        <SwiftUIButton
          onPress={onPress}
          modifiers={[
            frame({ height: iosHeight, width: iosWidth, alignment: 'center' }),
            glassEffect({
              shape: 'capsule',
              glass: {
                tint: opacity(getPrimaryColor('500'), 0.15),
                variant: 'regular',
                interactive: false,
              },
            }),
          ]}>
          <SwiftUIHStack
            alignment="center"
            spacing={5}
            modifiers={[frame({ width: iosWidth, alignment: 'center' })]}>
            <SwiftUIImage
              systemName="lock.fill"
              size={12}
              color={opacity(getPrimaryColor('0'), 0.75)}
            />
            <SwiftUIText
              modifiers={[
                font({ size: textSize, design: 'monospaced', weight: 'bold' }),
                foregroundStyle(opacity(getPrimaryColor('0'), 0.75)),
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
          backgroundColor: opacity(getPrimaryColor('500'), 0.3),
          borderWidth: 1,
          borderColor: opacity(getPrimaryColor('400'), 0.3),
          paddingHorizontal: 12,
          paddingVertical: 5,
        }}>
        <Icon name="majesticons:coins" size={14} color={opacity(getPrimaryColor('0'), 0.66)} />
        <UntranslatedText
          bold
          size={11}
          color={opacity(getPrimaryColor('0'), 0.66)}
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
  const manager = useManager();
  const { balance: liveBalances } = useBalanceContext();
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
  const [reservedTotal, setReservedTotal] = useState(0);
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
    router.push({
      pathname: '/transactions',
      params: {
        account: JSON.stringify(account),
        filterCurrency: account.unit,
        filterPaymentType: 'all',
        filterDirection: 'all',
        filterStatus: 'Pending',
        filterMintUrl: 'all',
      },
    });
  }, [router, account]);

  const handleReservedPress = useCallback(() => {
    Alert.alert('Reserved Proofs', 'Choose an action for all reserved proofs.', [
      { text: 'Close', style: 'cancel' },
      {
        text: 'Free All Reserved Proofs',
        style: 'destructive',
        onPress: async () => {
          try {
            const result = await CocoManager.freeAllReservedProofs();
            popup({
              message: 'Reserved proofs freed',
              type: 'success',
              text:
                `Reserved proofs found: ${result.totalReservedProofs}\n` +
                `Rolled back send ops: ${result.rolledBackSendOperations}\n` +
                `Rolled back melt ops: ${result.rolledBackMeltOperations}\n` +
                `Orphaned reservations released: ${result.releasedOrphanedReservations}\n` +
                `Errors: ${result.errors.length}`,
            });
          } catch (error) {
            popup({
              message: 'Failed to free reserved proofs',
              type: 'error',
              text: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        },
      },
    ]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadReserved = async () => {
      const repo = (manager as unknown as UnsafeManager).proofRepository;
      if (!repo?.getReservedProofs) {
        if (!cancelled) setReservedTotal(0);
        return;
      }

      try {
        const proofs = await repo.getReservedProofs();
        if (!cancelled) setReservedTotal(proofs.reduce((sum, proof) => sum + proof.amount, 0));
      } catch {
        if (!cancelled) setReservedTotal(0);
      }
    };

    loadReserved();
    return () => {
      cancelled = true;
    };
  }, [manager, liveBalances]);

  return (
    <VStack align="center" gap={8} className="z-9">
      <FiatCurrencyPill displayText={displayText} textSize={12} />
      <TouchableOpacity onPress={toggleUnit} className="flex-col items-center">
        <AmountFormatter weight="heavy" amount={balance} unit={account.unit} />
      </TouchableOpacity>
      <PendingEcashPill
        totalAmount={pendingTotal}
        unit={pendingUnit}
        onPress={handlePendingPress}
      />
      <ReservedEcashPill totalAmount={reservedTotal} unit="sat" onPress={handleReservedPress} />
    </VStack>
  );
}
