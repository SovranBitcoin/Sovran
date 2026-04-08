import React, { useEffect } from 'react';
import { View } from 'react-native';
import { Button, Toast } from 'heroui-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import { log } from '../logger';
import { useThemeColor } from '@/shared/hooks/useThemeColor';
import { blendColors, sanitizeColor } from '@/shared/lib/colorExtraction';
import { TOAST_COPY } from '@/shared/lib/paymentCopy';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { PaymentStatusIcon } from './PaymentStatusIcon';
import { fmt, isAmountSegment, type PopupTextSegment } from './format';
import { Text } from '@/shared/ui/primitives/Text';
import { AmountFormatter } from '@/shared/ui/composed/AmountFormatter';

type PaymentStatusToastVariant = 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request';

const ICON_SIZE = 32;

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
  const [foreground, overlay, success, danger] = useThemeColor([
    'foreground',
    'overlay',
    'success',
    'danger',
  ] as const);
  const overlayColor = sanitizeColor(String(overlay));
  const successMutedColor = blendColors(overlay, success, 0.15);
  const dangerMutedColor = blendColors(overlay, danger, 0.15);

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

  const targetColor = isFailed ? danger : success;
  const targetMutedColor = isFailed ? dangerMutedColor : successMutedColor;

  const backgroundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      confirmedProgress.get(),
      [0, 1],
      [overlayColor, targetMutedColor]
    ),
  }));

  const textColorStyle = useAnimatedStyle(() => ({
    color: interpolateColor(confirmedProgress.get(), [0, 1], [foreground, targetColor]),
  }));

  const onPressViewTransaction = async () => {
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
  };

  return (
    <Toast
      placement="top"
      className="overflow-hidden p-0"
      isAnimatedStyleActive={false}
      {...(toastProps as any)}>
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 16,
            paddingVertical: 14,
            gap: 12,
          },
          backgroundStyle,
        ]}>
        {/* Icon */}
        <PaymentStatusIcon size={ICON_SIZE} status={status} />

        {/* Title + Subtitle */}
        <View style={{ flex: 1, gap: 2 }}>
          <Animated.Text
            style={[{ fontSize: 15, fontWeight: '600' }, textColorStyle]}
            numberOfLines={1}>
            {config.message}
          </Animated.Text>
          {typeof submessage === 'string' ? (
            <Animated.Text style={[{ fontSize: 13 }, textColorStyle]} numberOfLines={1}>
              {submessage}
            </Animated.Text>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {(submessage as PopupTextSegment[]).map((segment, i) =>
                isAmountSegment(segment) ? (
                  <AmountFormatter
                    key={i}
                    size={11}
                    weight="heavy"
                    amount={segment.amount}
                    unit={segment.unit}
                  />
                ) : (
                  <Text key={i} size={11} weight="heavy">
                    {segment}
                  </Text>
                )
              )}
            </View>
          )}
        </View>

        {/* Action button — shown only when confirmed (not when failed) */}
        {isConfirmed && !isFailed && (
          <Toast.Action className="bg-foreground" onPress={onPressViewTransaction}>
            <Button.Label className="text-overlay">View</Button.Label>
          </Toast.Action>
        )}
      </Animated.View>
    </Toast>
  );
}
