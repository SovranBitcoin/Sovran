import React, { useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import type { GlassVariant } from 'liquid-glass-text';
import { VStack } from '@/shared/ui/primitives/View/VStack';
import { View } from '@/shared/ui/primitives/View/View';
import { UnitSwitcherPill } from '@/features/wallet/components/UnitSwitcherPill';
import { useSettingsStore, DisplayCurrency } from '@/shared/stores/global/settingsStore';
import { EnhancedHaptics } from '@/shared/ui/primitives/Haptics';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';
import { useBtcPrice } from '@/shared/stores/global/pricelistStore';
import { Pressable } from '@/shared/ui/primitives/Pressable';
import { FiatCurrencyPill } from '@/features/wallet/components/FiatCurrencyPill';
import opacity from 'hex-color-opacity';
import { useMockDataStore } from '@/shared/stores/runtime/mockDataStore';
import { CapsuleButton } from '@/shared/ui/composed/CapsuleButton';
import { useGuardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { actionMenuPopup, staticPopup } from '@/shared/lib/popup';
import { useColadaBalance } from 'wallet/react';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { walletLog, Log } from '@/shared/lib/logger';

interface Account {
  unit: CurrencyUnit;
}

type CurrencyUnit = 'sat' | 'usd' | 'eur' | string;
type DisplayBtcMode = 0 | 1 | 2 | 3;

export interface PillVisibility {
  pending: boolean;
  reserved: boolean;
  redeeming: boolean;
}

interface PrimaryBalanceProps {
  account: Account;
  /** Which status-pill slots to keep (invisibly) when locally zero — the
   *  carousel ORs visibility across its pages so pills align without
   *  reserving space nobody uses. */
  reservePillSlots?: PillVisibility;
  /** Report this account's pill visibility up to the carousel. */
  onPillVisibilityChange?: (unit: string, visibility: PillVisibility) => void;
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
const PILL_HEIGHT = 30;
const PILL_ICON_SIZE = 14;

interface EcashStatusPillProps {
  label: string;
  totalAmount: number;
  unit: string;
  onPress: () => void;
  /** Keep an invisible same-size slot when the amount is zero — set when
   *  ANY carousel account shows this pill, so it sits at the same position
   *  on every page. Unreserved zero pills render nothing (no dead space). */
  reserveSlot?: boolean;
}

function EcashStatusPill({
  label,
  totalAmount,
  unit,
  onPress,
  reserveSlot = false,
}: EcashStatusPillProps): React.ReactElement | null {
  const foreground = useThemeColor('foreground');

  // Zero-amount pills keep an INVISIBLE slot only when some other account
  // page shows this pill (cross-page alignment); otherwise they render
  // nothing at all — no dead space below the balance.
  const isPlaceholder = totalAmount <= 0;
  if (isPlaceholder && !reserveSlot) return null;
  const text = `${label}: ${(isPlaceholder ? 0 : totalAmount).toLocaleString()} ${unit.toUpperCase()}`;

  return (
    <View
      style={[styles.statusPillButtonSlot, isPlaceholder && styles.hiddenSlot]}
      pointerEvents={isPlaceholder ? 'none' : 'auto'}>
      <CapsuleButton
        label={text}
        icon="majesticons:coins"
        onPress={isPlaceholder ? () => {} : onPress}
        color={opacity(foreground, 0.85)}
        height={PILL_HEIGHT}
        fitContent
        iconSize={PILL_ICON_SIZE}
        textSize={PILL_TEXT_SIZE}
        labelNumberOfLines={1}
        contentStyle={styles.statusPillContent}
        textStyle={styles.statusPillText}
      />
    </View>
  );
}

/**
 * Component that displays the primary balance with unit toggling capability
 */
export function PrimaryBalance({
  account,
  reservePillSlots,
  onPillVisibilityChange,
}: PrimaryBalanceProps): React.ReactElement {
  const router = useGuardedRouter();
  const displayBtc = useSettingsStore((state) => state.getDisplayBtc());
  const setDisplayBtc = useSettingsStore((state) => state.setDisplayBtc);
  const displayCurrency = useSettingsStore((state) => state.displayCurrency);
  const mockMode = useSettingsStore((state) => state.mockMode);
  const mockBalance = useMockDataStore((state) => state.mockBalance);
  const mockPendingAmount = useMockDataStore((state) => state.mockPendingAmount);
  // Single colada read model for every figure, scoped to the active mint
  // unit: total (spendable + reserved), reserved, pending (cancellable ecash
  // sends), and redeeming (received-but-unredeemed ecash — e.g. P2PK tokens
  // accepted offline, invisible otherwise).
  const breakdown = useColadaBalance(account.unit);
  const btcPrice = useBtcPrice(displayCurrency);
  const isSatUnit = account.unit === 'sat';

  const toggleUnit = useCallback(async () => {
    // displayBtc cycling re-formats a SAT balance (sat/BTC/⚡ modes); it has
    // no meaning for a fiat-denominated wallet unit.
    if (!isSatUnit) return;
    await EnhancedHaptics.successHaptic();
    setDisplayBtc(((displayBtc + 1) % 4) as DisplayBtcMode);
  }, [displayBtc, setDisplayBtc, isSatUnit]);

  const balance = mockMode ? mockBalance : breakdown.total;
  const reservedTotal = breakdown.reserved;
  const pendingTotal = mockMode ? mockPendingAmount : breakdown.pending;
  const lockedTotal = breakdown.redeeming;
  // Pills sum amounts in the active unit (matches the balance above).
  const pendingUnit = account.unit;
  const lockedUnit = account.unit;

  useEffect(() => {
    onPillVisibilityChange?.(account.unit, {
      pending: pendingTotal > 0,
      reserved: reservedTotal > 0,
      redeeming: lockedTotal > 0,
    });
  }, [onPillVisibilityChange, account.unit, pendingTotal, reservedTotal, lockedTotal]);

  const currencyConfig = CURRENCY_CONFIG[displayCurrency];
  const fiatValue = btcPrice ? ((btcPrice / 100_000_000) * balance).toFixed(2) : '0.00';
  const foreground = useThemeColor('foreground');
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
        {/* Wallet unit above the balance: the unit is the structural choice
            (what the balance IS); the display-currency pill below only
            re-prices it. */}
        <UnitSwitcherPill
          textSize={12}
          displayUnit={
            account.unit === 'sat' ||
            account.unit === 'usd' ||
            account.unit === 'eur' ||
            account.unit === 'gbp'
              ? account.unit
              : undefined
          }
        />
        <Pressable onPress={toggleUnit} style={styles.balancePressable}>
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
        {/* Fiat conversion of a sat balance is meaningless when the wallet
            is already denominated in a fiat unit — but the SLOT stays (an
            invisible pill of the same size) so the pills below sit at
            identical positions on every carousel page. */}
        <View
          style={isSatUnit ? undefined : styles.hiddenSlot}
          pointerEvents={isSatUnit ? 'auto' : 'none'}>
          {/* testID only on the live (sat-page) pill — the hidden layout slots
              on fiat pages would otherwise duplicate the id in the AX tree. */}
          <FiatCurrencyPill
            displayText={isSatUnit ? displayText : '≈ 0.00'}
            textSize={12}
            testID={isSatUnit ? 'wallet-fiat-pill' : undefined}
            accessibilityLabel={isSatUnit ? 'Change display currency' : undefined}
          />
          {/* e2e probe: the pill renders through a native menu whose AX value
              forwarding is platform-dependent, so the persisted selection is
              mirrored here (wallet-wallpaper:<slug> pattern) — screenshots
              alone cannot prove which currency survived a relaunch. */}
          {isSatUnit ? (
            <View
              testID={`wallet-fiat-currency:${displayCurrency}`}
              accessible
              accessibilityRole="text"
              accessibilityLabel="Display currency probe"
              importantForAccessibility="yes"
              collapsable={false}
              pointerEvents="none"
              style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1 }}
            />
          ) : null}
        </View>
        <EcashStatusPill
          label="PENDING"
          totalAmount={pendingTotal}
          unit={pendingUnit}
          onPress={handlePendingPress}
          reserveSlot={reservePillSlots?.pending}
        />
        <EcashStatusPill
          label="RESERVED"
          totalAmount={reservedTotal}
          unit={account.unit}
          onPress={handleReservedPress}
          reserveSlot={reservePillSlots?.reserved}
        />
        <EcashStatusPill
          label="REDEEMING"
          totalAmount={lockedTotal}
          unit={lockedUnit}
          onPress={handleRedeemingPress}
          reserveSlot={reservePillSlots?.redeeming}
        />
      </VStack>
    </Log>
  );
}

const styles = StyleSheet.create({
  // Placeholder slots: identical size, invisible, untappable — layout
  // consistency across carousel pages.
  hiddenSlot: {
    opacity: 0,
  },
  statusPillButtonSlot: {
    alignSelf: 'center',
    maxWidth: '92%',
  },
  statusPillContent: {
    paddingHorizontal: 12,
    gap: 6,
  },
  statusPillText: {
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  balancePressable: {
    alignSelf: 'stretch',
    height: BALANCE_TAP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
