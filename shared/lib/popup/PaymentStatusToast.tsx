import React, { useEffect } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { Button, Toast } from 'heroui-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import opacity from 'hex-color-opacity';
import { log } from '../logger';
import { supportsBlur } from '@/shared/lib/version';
import { formatAmount } from '@/shared/lib/currency';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { TOAST_COPY } from '@/shared/lib/paymentCopy';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { PaymentStatusIcon } from './PaymentStatusIcon';
import { fmt, isAmountSegment, type PopupTextSegment } from './format';
import { useToastSurface } from './useToastSurface';
import { DANGER_DARK_BG, SUCCESS_DARK_BG, TINT_ALPHA, ToastSlab } from './ToastSlab';

type PaymentStatusToastVariant = 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request';

const ICON_SIZE = 32;
const SEGMENT_FONT_SIZE = 13;

/**
 * Inline amount renderer. The shared `AmountFormatter` is overkill for the
 * toast — we just need formatted text in the same font with the toast's
 * static foreground color (text colors don't animate; only the bg/icon
 * react to confirmation/failure).
 */
function ToastAmountText({ amount, unit, color }: { amount: number; unit: string; color: string }) {
  const displayBtc = useSettingsStore((s) => s.getDisplayBtc());
  const formatted = formatAmount({ amount, unit }, { useUserPreference: true });
  // Mirrors `decorate` in AmountFormatter.tsx — only sat amounts get a
  // ₿ prefix or ⚡︎ suffix, depending on the user's display preference.
  const decorated =
    unit !== 'sat'
      ? formatted
      : displayBtc === 0 || displayBtc === 3
        ? `₿ ${formatted}`
        : displayBtc === 1
          ? `${formatted} ⚡︎`
          : formatted;
  return (
    <RNText style={{ fontFamily: 'MonaSans-Black', fontSize: SEGMENT_FONT_SIZE, color }}>
      {decorated}
    </RNText>
  );
}

const CASES = {
  receive: {
    message: TOAST_COPY.receive.message,
    submessagePending: TOAST_COPY.receive.processing,
    submessageConfirmed: (amount: number, unit: string) =>
      fmt`${TOAST_COPY.receive.confirmed} ${{ amount, unit }}`,
    submessageFailed: TOAST_COPY.receive.failed,
    history: { type: 'mint' as const, idField: 'quoteId' as const },
    route: { pathname: '/mintQuote' as const, paramKey: 'mintHistoryEntry' },
  },
  send: {
    message: TOAST_COPY.send.message,
    submessagePending: TOAST_COPY.send.processing,
    submessageConfirmed: (amount: number, unit: string) =>
      fmt`${TOAST_COPY.send.confirmed} ${{ amount, unit }}`,
    submessageFailed: TOAST_COPY.send.failed,
    history: { type: 'send' as const, idField: 'operationId' as const },
    route: { pathname: '/sendToken' as const, paramKey: 'sendHistoryEntry' },
  },
  'payment-request': {
    message: TOAST_COPY['payment-request'].message,
    submessagePending: TOAST_COPY['payment-request'].processing,
    submessageDelivered: TOAST_COPY['payment-request'].delivered,
    submessageConfirmed: TOAST_COPY['payment-request'].confirmed,
    submessageFailed: TOAST_COPY['payment-request'].failed,
    history: { type: 'send' as const, idField: 'operationId' as const },
    route: { pathname: '/sendToken' as const, paramKey: 'sendHistoryEntry' },
  },
  melt: {
    message: TOAST_COPY.melt.message,
    submessagePending: TOAST_COPY.melt.processing,
    submessageConfirmed: (amount: number, unit: string) =>
      fmt`${TOAST_COPY.melt.confirmed} ${{ amount, unit }}`,
    submessageFailed: TOAST_COPY.melt.failed,
    history: { type: 'melt' as const, idField: 'quoteId' as const },
    route: { pathname: '/meltQuote' as const, paramKey: 'meltHistoryEntry' },
  },
  'receive-ecash': {
    message: TOAST_COPY['receive-ecash'].message,
    submessagePending: TOAST_COPY['receive-ecash'].processing,
    submessageConfirmed: (amount: number, unit: string) =>
      fmt`${TOAST_COPY['receive-ecash'].confirmed} ${{ amount, unit }}`,
    submessageFailed: TOAST_COPY['receive-ecash'].failed,
    history: { type: 'receive' as const, idField: 'id' as const },
    route: { pathname: '/receiveToken' as const, paramKey: 'receiveHistoryEntry' },
  },
} as const;

type PaymentStatusToastProps = {
  variant: PaymentStatusToastVariant;
  /** Payment id (quoteId or operationId or receiveHistoryEntry.id) */
  paymentId: string;
  mintUrl: string;
  amount: number;
  unit: string;
  /** For melt: operationId used to construct MeltHistoryEntry when not in history */
  operationId?: string;
  /** For receive-ecash: receiveEntryId set when receive:created fires, used for View button */
  receiveEntryId?: string;
  /** All remaining props come from ToastComponentProps and are forwarded to Toast root */
  [key: string]: unknown;
};

export function PaymentStatusToast({
  variant,
  paymentId,
  mintUrl,
  amount,
  unit,
  operationId,
  receiveEntryId,
  ...toastProps
}: PaymentStatusToastProps) {
  const hide = toastProps.hide as (ids?: string | string[] | 'all') => void;
  const config = CASES[variant];
  const active = usePaymentStatusStore((s) => s.active);
  const isDelivered = active?.id === paymentId && active?.state === 'delivered';
  const isConfirmed = active?.id === paymentId && active?.state === 'confirmed';
  const isFailed = active?.id === paymentId && active?.state === 'failed';
  const status: 'pending' | 'delivered' | 'confirmed' | 'failed' = isConfirmed
    ? 'confirmed'
    : isFailed
      ? 'failed'
      : isDelivered
        ? 'delivered'
        : 'pending';
  // For melt: operationId may be set by melt-op:finalized after toast mounts
  const effectiveOperationId =
    variant === 'melt' ? (active?.operationId ?? operationId) : operationId;
  // For receive-ecash: receiveEntryId may be set by receive:created after toast mounts
  const effectiveReceiveEntryId =
    variant === 'receive-ecash' ? (active?.receiveEntryId ?? receiveEntryId) : undefined;
  const confirmedSubmessage =
    typeof config.submessageConfirmed === 'function'
      ? config.submessageConfirmed(amount, unit)
      : config.submessageConfirmed;

  const submessage = isConfirmed
    ? confirmedSubmessage
    : isFailed
      ? (active?.errorMessage ?? config.submessageFailed)
      : isDelivered && 'submessageDelivered' in config
        ? config.submessageDelivered
        : 'submessagePending' in config
          ? config.submessagePending
          : confirmedSubmessage;

  // --- Animated colors ---
  // Frosted-glass slab: BlurView at the back, an animated semi-transparent
  // tint above it, content on top. On confirmation/failure ONLY the tint
  // bg and the PaymentStatusIcon react — text colors stay constant on the
  // toast surface so the readout doesn't reflow under the user.
  const { bg: surfaceBg, fg: surfaceFg } = useToastSurface();
  const blurSupported = supportsBlur();
  const surfaceBgTint = blurSupported ? opacity(surfaceBg, TINT_ALPHA) : surfaceBg;

  const confirmedProgress = useSharedValue(isConfirmed || isFailed ? 1 : 0);

  useEffect(() => {
    if (isConfirmed || isFailed) {
      confirmedProgress.set(withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) }));
    }
  }, [isConfirmed, isFailed, confirmedProgress]);

  // Auto-dismiss after confirmation or failure
  useEffect(() => {
    if (!isConfirmed && !isFailed) return;
    const timer = setTimeout(() => hide(), 3000);
    return () => clearTimeout(timer);
  }, [isConfirmed, isFailed, hide]);

  const targetBgColor = isFailed ? DANGER_DARK_BG : SUCCESS_DARK_BG;
  const targetBgTint = blurSupported ? opacity(targetBgColor, TINT_ALPHA) : targetBgColor;

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      confirmedProgress.get(),
      [0, 1],
      [surfaceBgTint, targetBgTint]
    ),
  }));

  // Wrap in single-flight: a rapid double-tap on the toast's "View" action
  // would otherwise call `getPaginatedHistory(0, 100)` twice and stack two
  // copies of the destination screen on the back stack — `guardedRouter`'s
  // 600ms debounce only catches the navigation, not the history fetch.
  const onPressViewTransaction = useSingleFlight(async () => {
    try {
      if (!CocoManager.isInitialized()) return;
      const manager = CocoManager.getInstance();
      const history = await manager.history.getPaginatedHistory(0, 100);
      const { type, idField } = config.history;
      // For receive-ecash, use effectiveReceiveEntryId when available (real entry id from receive:created)
      const lookupId =
        variant === 'receive-ecash' && effectiveReceiveEntryId
          ? effectiveReceiveEntryId
          : paymentId;
      let entry = history.find(
        (h) =>
          h.type === type &&
          idField in h &&
          (h as Record<string, unknown>)[idField] === lookupId &&
          h.mintUrl === mintUrl
      );
      // v3 melts are not in history; construct MeltHistoryEntry from operationId
      if (!entry && variant === 'melt' && effectiveOperationId) {
        entry = {
          type: 'melt',
          id: effectiveOperationId,
          quoteId: paymentId,
          mintUrl,
          amount,
          unit,
          state: 'PAID',
          createdAt: Date.now(),
        } as const;
      }
      if (entry) {
        router.navigate({
          pathname: config.route.pathname,
          params: { [config.route.paramKey]: JSON.stringify(entry) },
        });
      }
    } catch (e) {
      log.warn('popup.open_transaction_failed', { error: e });
    }
    hide();
  });

  return (
    <ToastSlab
      toastProps={toastProps}
      tint={<Animated.View style={[StyleSheet.absoluteFill, backgroundStyle]} />}>
      {/* Icon — base color tracks the toast surface foreground so the
          initial pre-confirmation render reads on the dark slab. */}
      <PaymentStatusIcon size={ICON_SIZE} status={status} baseColor={surfaceFg} />

      {/* Title + Subtitle — colors stay constant; only bg + icon react
          to confirmation/failure. */}
      <View style={{ flex: 1, gap: 2 }}>
        <RNText style={{ fontSize: 15, fontWeight: '600', color: surfaceFg }} numberOfLines={1}>
          {config.message}
        </RNText>
        {typeof submessage === 'string' ? (
          <RNText style={{ fontSize: 13, color: surfaceFg }} numberOfLines={1}>
            {submessage}
          </RNText>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {(submessage as PopupTextSegment[]).map((segment, i) =>
              isAmountSegment(segment) ? (
                <ToastAmountText
                  key={i}
                  amount={segment.amount}
                  unit={segment.unit}
                  color={surfaceFg}
                />
              ) : (
                <RNText
                  key={i}
                  style={{
                    fontFamily: 'MonaSans-Black',
                    fontSize: SEGMENT_FONT_SIZE,
                    color: surfaceFg,
                  }}>
                  {segment as string}
                </RNText>
              )
            )}
          </View>
        )}
      </View>

      {/* Action button — shown only when confirmed (not when failed).
          Uses the neutral toast surface inverse (light pill, dark label)
          so it stays theme-tinted instead of taking on the success
          green wash. */}
      {isConfirmed && !isFailed && (
        <Toast.Action style={{ backgroundColor: surfaceFg }} onPress={onPressViewTransaction}>
          <Button.Label style={{ color: surfaceBg }}>View</Button.Label>
        </Toast.Action>
      )}
    </ToastSlab>
  );
}
