import React from 'react';
import { Text as RNText, View } from 'react-native';
import { MeltQuoteState } from '@cashu/cashu-ts';
import { createPaymentCopyGroups, type PaymentCopyResolver } from '@sovranbitcoin/colada';

import { popupLog } from '../logger';
import { formatAmount } from '@/shared/lib/currency';
import { LIGHTNING_GOLD } from '@/shared/lib/brandColors';
import { usePaymentCopyResolver } from '@/shared/hooks/usePaymentCopyResolver';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import { usePaymentStatusStore } from '@/shared/stores/runtime/paymentStatusStore';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import {
  getMeltDetailPathname,
  getMintDetailPathname,
} from '@/shared/lib/nav/transactionDetailRoutes';
import { useToastSurface } from './useToastSurface';
import { fmt, isAmountSegment, type PopupTextSegment } from './format';
import { StatusToast, type StatusToastStatus } from './StatusToast';

type PaymentStatusToastVariant = 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request';

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

function createPaymentStatusToastCases(paymentCopy: PaymentCopyResolver) {
  const { TOAST_COPY } = createPaymentCopyGroups(paymentCopy);

  return {
    receive: {
      message: TOAST_COPY.receive.message,
      submessagePending: TOAST_COPY.receive.processing,
      submessageConfirmed: (amount: number, unit: string) =>
        fmt`${TOAST_COPY.receive.confirmed} ${{ amount, unit }}`,
      submessageFailed: TOAST_COPY.receive.failed,
      history: { type: 'mint' as const, idField: 'quoteId' as const },
      route: { pathname: '/lightningReceive' as const, paramKey: 'mintHistoryEntry' },
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
      route: { pathname: '/lightningSend' as const, paramKey: 'meltHistoryEntry' },
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
}

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
  const paymentCopy = usePaymentCopyResolver();
  const cases = React.useMemo(() => createPaymentStatusToastCases(paymentCopy), [paymentCopy]);
  const config = cases[variant];
  const active = usePaymentStatusStore((s) => s.active);
  const isDelivered = active?.id === paymentId && active?.state === 'delivered';
  const isConfirmed = active?.id === paymentId && active?.state === 'confirmed';
  const isFailed = active?.id === paymentId && active?.state === 'failed';
  const status: StatusToastStatus = isConfirmed
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

  // Foreground tracks the toast surface so the segmented amount row matches
  // the rest of the title/subtitle text in both light and dark themes.
  const { fg: surfaceFg } = useToastSurface();

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
        const now = Date.now();
        entry = {
          type: 'melt',
          id: effectiveOperationId,
          quoteId: paymentId,
          mintUrl,
          amount,
          unit,
          state: MeltQuoteState.PAID,
          createdAt: now,
        } as const;
      }
      if (entry) {
        if (entry.type === 'mint') {
          guardedRouter.navigate({
            pathname: getMintDetailPathname(entry),
            params: { mintHistoryEntry: JSON.stringify(entry) },
          });
        } else if (entry.type === 'melt') {
          guardedRouter.navigate({
            pathname: getMeltDetailPathname(entry),
            params: { meltHistoryEntry: JSON.stringify(entry) },
          });
        } else {
          guardedRouter.navigate({
            pathname: config.route.pathname,
            params: { [config.route.paramKey]: JSON.stringify(entry) },
          });
        }
      }
    } catch (e) {
      popupLog.warn('popup.open_transaction_failed', { error: e });
    }
    hide();
  });

  const subtitleNode =
    typeof submessage === 'string' ? (
      submessage
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
    );

  // Action shown only on confirmed (not on failed) — failure leaves the
  // toast empty on the right so the error message has full breathing room.
  const action =
    isConfirmed && !isFailed ? { label: 'View', onPress: onPressViewTransaction } : undefined;

  // Nut Drop special case: while the radar screen is up, an incoming ecash
  // receive is already being celebrated with storm-gold lightning — the
  // toast matches it (title + confirmed tint) instead of the generic green.
  // Reactive on purpose: leave the radar and the toast reverts.
  const radarVisible = useNearPaySessionStore((s) => s.radarVisible);
  const nutDropGold = variant === 'receive-ecash' && radarVisible;

  return (
    <StatusToast
      status={status}
      title={nutDropGold ? 'Received payment' : config.message}
      subtitle={subtitleNode}
      action={action}
      confirmedTint={nutDropGold ? LIGHTNING_GOLD : undefined}
      toastProps={{ ...toastProps, hide }}
    />
  );
}
