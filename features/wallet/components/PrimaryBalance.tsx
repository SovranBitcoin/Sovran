import React, { useCallback, useEffect } from 'react';
import type { GlassVariant } from 'liquid-glass-text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { HStack } from '@/shared/ui/primitives/View/HStack';
import { useSettingsStore, DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { UntranslatedText } from '@/shared/ui/primitives/Text';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { FiatCurrencyPill } from '@/features/wallet/components/FiatCurrencyPill';
import Icon from 'assets/icons';
import opacity from 'hex-color-opacity';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { GlassView } from 'expo-glass-effect';
import { useCapabilities } from '@/shared/ui/capability';
import { useGuardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { actionMenuPopup, staticPopup } from '@/shared/lib/popup';
import { useColadaBalance } from '@sovranbitcoin/colada/react';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { alpha } from '@/shared/styles/tokens';
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
const BALANCE_TEXT_SIZE = 42;
const BALANCE_TEXT_LINE_HEIGHT = 54;
const BALANCE_TAP_HEIGHT = 60;
const BALANCE_SECTION_GAP = 18;

// ---------------------------------------------------------------------------
// Shared ecash status pill (pending / reserved / etc.)
// ---------------------------------------------------------------------------

const PILL_TEXT_SIZE = 11;

interface EcashStatusPillProps {
  label: string;
  totalAmount: number;
  unit: string;
  /** Retained for caller compatibility; the GlassView pill renders an RN icon. */
  sfSymbol?: string;
  tintColor?: string;
  onPress?: () => void;
}

function EcashStatusPill({
  label,
  totalAmount,
  unit,
  tintColor,
  onPress,
}: EcashStatusPillProps): React.ReactElement | null {
  const [foreground, surfaceSecondary, mutedColor] = useThemeColor([
    'foreground',
    'surface-secondary',
    'muted',
  ] as const);
  const tint = tintColor ?? foreground;
  const { liquidGlass } = useCapabilities();

  if (totalAmount <= 0) return null;

  const text = `${label}: ${totalAmount.toLocaleString()} ${unit.toUpperCase()}`;

  // Liquid Glass via expo-glass-effect's GlassView (UIVisualEffectView, a real
  // RN view) instead of an @expo/ui SwiftUI Host — Host views (UIHostingController)
  // pin to the top inside an RN ScrollView instead of following the scroll
  // (expo/expo#46278). GlassView scrolls correctly.
  if (liquidGlass) {
    return (
      <Pressable onPress={onPress} disabled={!onPress} activeOpacity={0.9}>
        <GlassView
          glassEffectStyle="regular"
          isInteractive={false}
          {...(tintColor ? { tintColor: opacity(tint, 0.15) } : {})}
          style={{ borderRadius: 999, overflow: 'hidden' }}>
          <HStack
            align="center"
            justify="center"
            gap={6}
            style={{ paddingHorizontal: 12, paddingVertical: 5 }}>
            <Icon name="majesticons:coins" size={14} color={opacity(tint, 0.85)} />
            <UntranslatedText
              overpass
              bold
              size={PILL_TEXT_SIZE}
              color={opacity(tint, 0.85)}
              style={{ letterSpacing: 0.5 }}>
              {text}
            </UntranslatedText>
          </HStack>
        </GlassView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={onPress} disabled={!onPress} activeOpacity={0.9}>
      <HStack
        align="center"
        justify="center"
        gap={6}
        className="overflow-hidden rounded-full"
        style={{
          // Standard flat-pill recipe: untinted = surface-secondary + muted
          // border (CircleActionButton contract); tinted (RESERVED) mirrors
          // the liquid glassEffect tint at alpha.subtle.
          backgroundColor: tintColor ? opacity(tint, alpha.subtle) : surfaceSecondary,
          borderWidth: 1,
          borderColor: tintColor ? opacity(tint, 0.3) : opacity(mutedColor, 0.3),
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
    </Pressable>
  );
}

/**
 * Component that displays the primary balance with unit toggling capability
 */
export function PrimaryBalance({ account }: PrimaryBalanceProps): React.ReactElement {
  const router = useGuardedRouter();
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());
  const setDisplayBtc = useSettingsStore((state) => state.setDisplayBtc);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const mockMode = useSettingsStore((state) => state.mockMode);
  const mockBalance = useMockDataStore((state) => state.mockBalance);
  const mockPendingAmount = useMockDataStore((state) => state.mockPendingAmount);
  // Single colada read model for every figure: total (spendable + reserved),
  // reserved, pending (cancellable ecash sends), and redeeming (received-but-
  // unredeemed ecash — e.g. P2PK tokens accepted offline, invisible otherwise).
  const breakdown = useColadaBalance();
  const btcPrice = useBtcPrice(displayCurrency);

  const toggleUnit = useCallback(async () => {
    await EnhancedHaptics.successHaptic();
    setDisplayBtc(((displayBtc + 1) % 4) as DisplayBtcMode);
  }, [displayBtc, setDisplayBtc]);

  const balance = mockMode ? mockBalance : breakdown.total;
  const reservedTotal = breakdown.reserved;
  const pendingTotal = mockMode ? mockPendingAmount : breakdown.pending;
  const lockedTotal = breakdown.redeeming;
  // Pills sum sat-denominated amounts; label as sat (matches RESERVED).
  const pendingUnit = 'sat';
  const lockedUnit = 'sat';

  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const fiatValue = btcPrice ? ((btcPrice / 100_000_000) * balance).toFixed(2) : '0.00';
  const [foreground, warning, accent] = useThemeColor(['foreground', 'warning', 'accent'] as const);
  const balanceTint = opacity(foreground, LIQUID_GLASS_BALANCE_TINT_ALPHA);

  useEffect(() => {
    walletLog.debug('wallet.balance.ecash_status', {
      accountUnit: account.unit,
      pendingTotal,
      reservedTotal,
      lockedTotal,
      mockMode,
    });
  }, [account.unit, mockMode, pendingTotal, reservedTotal, lockedTotal]);

  const displayText = `≈ ${currencyConfig.symbol}${fiatValue}`;
  const handlePendingPress = useCallback(() => {
    walletLog.info('wallet.pending.press', {
      pendingTotal,
      unit: pendingUnit,
    });
    router.navigate({
      pathname: '/transactions',
      params: {
        filterCurrency: account.unit,
        filterPaymentType: 'ecash',
        filterDirection: 'outgoing',
        filterStatus: 'Pending',
        filterMintUrl: 'all',
      },
    });
  }, [router, account.unit, pendingTotal, pendingUnit]);

  // Wrap the menu in a promise so a rapid second tap on the Reserved pill is
  // dropped by `useSingleFlight` until the first interaction settles.
  const handleReservedPressInner = useCallback(async () => {
    const recoverPending = async () => {
      walletLog.info('wallet.reserved.recovery_start', { reservedTotal });
      try {
        const manager = CocoManager.getInstance();

        await manager.ops.send.recovery.run();
        await manager.ops.melt.recovery.run();
        // Also redeem any receives stranded in `executing` (e.g. P2PK tokens
        // accepted while offline) so the same action drains incoming limbo.
        await manager.ops.receive.recovery.run();
        walletLog.info('wallet.reserved.recovery_complete');
        staticPopup('reserved-proofs-freed', {
          text:
            'Recovery completed.\n' +
            'Checked pending send, melt, and receive operations.\n' +
            'If reserved balance is still stuck, use force cleanup.',
        });
      } catch (error) {
        walletLog.error('wallet.reserved.recovery_failed', {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        staticPopup('reserved-proofs-failed', {
          text: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    walletLog.info('wallet.reserved.menu_open', { reservedTotal });
    await new Promise<void>((resolve) => {
      actionMenuPopup({
        title: 'Reserved Proofs',
        // Fires on overlay-tap / swipe-down (no item picked); the picked
        // path resolves from the button's onPress finally-block instead.
        onDismiss: () => {
          walletLog.debug('wallet.reserved.menu_dismissed');
          resolve();
        },
        buttons: [
          {
            testID: 'reserved-proofs-recover',
            text: 'Recover pending operations',
            description: 'Checks pending send, melt, and receive operations',
            icon: 'mdi:wrench',
            onPress: async () => {
              walletLog.info('wallet.reserved.recovery_selected', { reservedTotal });
              try {
                await recoverPending();
              } finally {
                resolve();
              }
            },
          },
        ],
      });
    });
  }, [reservedTotal]);

  const handleReservedPress = useSingleFlight(handleReservedPressInner);

  // REDEEMING pill: retry redeeming received-but-unswapped ecash. Tapping runs
  // coco's receive recovery sweep, which swaps any `executing` receives once
  // the mint is reachable; on success they leave limbo and join the balance.
  const handleRedeemingPressInner = useCallback(async () => {
    walletLog.info('wallet.redeeming.recovery_start', { lockedTotal });
    try {
      const manager = CocoManager.getInstance();
      await manager.ops.receive.recovery.run();
      walletLog.info('wallet.redeeming.recovery_complete');
      staticPopup('redeem-receives-done', {
        text:
          'Checked unredeemed ecash.\n' +
          'Anything redeemable is now in your balance. Tokens still waiting ' +
          'need the mint to be reachable.',
      });
    } catch (error) {
      walletLog.error('wallet.redeeming.recovery_failed', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      staticPopup('redeem-receives-failed', {
        text: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }, [lockedTotal]);

  const handleRedeemingPress = useSingleFlight(handleRedeemingPressInner);

  return (
    <Log name="PrimaryBalance">
      <VStack align="center" gap={BALANCE_SECTION_GAP} className="z-9">
        <FiatCurrencyPill displayText={displayText} textSize={12} />
        <Pressable
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
            size={BALANCE_TEXT_SIZE}
            lineHeight={BALANCE_TEXT_LINE_HEIGHT}
            weight="heavy"
            liquid
            glassVariant={LIQUID_GLASS_BALANCE_VARIANT}
            color={balanceTint}
          />
        </Pressable>
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
        <EcashStatusPill
          label="REDEEMING"
          totalAmount={lockedTotal}
          unit={lockedUnit}
          sfSymbol="hourglass"
          tintColor={accent}
          onPress={handleRedeemingPress}
        />
      </VStack>
    </Log>
  );
}
