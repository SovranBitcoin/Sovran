import React from 'react';
import { Text as RNText, View } from 'react-native';
import { createPaymentCopyGroups } from 'wallet';

import { popupLog } from '../logger';
import { formatAmount } from '@/shared/lib/currency';
import { usePaymentCopyResolver } from '@/shared/hooks/usePaymentCopyResolver';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { useNearPaySessionStore } from '@/shared/stores/runtime/nearPayStore';
import {
  usePaymentStatusStore,
  type PaymentToastView,
} from '@/shared/stores/runtime/paymentStatusStore';
import { guardedRouter } from '@/shared/hooks/useGuardedRouter';
import { useSingleFlight } from '@/shared/hooks/useSingleFlight';
import { useToastSurface } from './useToastSurface';
import { isAmountSegment } from './format';
import { presentPaymentToast } from './paymentToastPresentation';
import { openToastTransaction } from './paymentToastTarget';
import { StatusToast } from './StatusToast';
import { E2EPaymentToastRenderMarker } from './E2EToastProbe';

const SEGMENT_FONT_SIZE = 13;

/**
 * Inline amount renderer. The shared `AmountFormatter` is overkill for the
 * toast — we just need formatted text in the same font with the toast's
 * static foreground color (text colors don't animate; only the bg/icon
 * react to confirmation/failure).
 */
function ToastAmountText({ amount, unit, color }: { amount: number; unit: string; color: string }) {
  const displayBtc = useSettingsStore((s) => s.displayBtc);
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

type PaymentStatusToastProps = {
  /** The toast to draw: its id in `usePaymentStatusStore.toasts`. */
  paymentToastId: string;
  /** All remaining props come from ToastHost and are forwarded to the slab. */
  [key: string]: unknown;
};

/**
 * One payment's toast. It draws what the payment toast machine says is on
 * screen for it and decides nothing itself: no timers, no phase logic.
 * Tapping it (anywhere, or View once the payment is done) opens that
 * transaction.
 */
export function PaymentStatusToast({ paymentToastId, ...toastProps }: PaymentStatusToastProps) {
  const hide = toastProps.hide as (ids?: string | string[] | 'all') => void;
  const live = usePaymentStatusStore((s) => s.toasts.find((t) => t.id === paymentToastId));
  // The machine drops a toast the moment it closes, while the stack is still
  // animating it out: keep drawing what it last showed. Adjusted during
  // render (not a ref write) so the React Compiler keeps this component.
  const [last, setLast] = React.useState<PaymentToastView | undefined>(live);
  if (live && live !== last) setLast(live);
  const view = live ?? last;

  const paymentCopy = usePaymentCopyResolver();
  const copy = React.useMemo(() => createPaymentCopyGroups(paymentCopy).TOAST_COPY, [paymentCopy]);
  // Foreground tracks the toast surface so the segmented amount row matches
  // the rest of the title/subtitle text in both light and dark themes.
  const { fg: surfaceFg } = useToastSurface();
  // Nut Drop special case: while the radar screen is up, an incoming ecash
  // receive is titled "Received payment" (the lightning ceremony is already
  // playing — the toast just confirms it). Reactive on purpose: leave the
  // radar and the title reverts.
  const radarVisible = useNearPaySessionStore((s) => s.radarVisible);

  const content = view?.content;
  const phase = view?.phase;
  React.useEffect(() => {
    if (!phase) return;
    popupLog.info('popup.status_toast.status', { paymentToastId, phase });
  }, [paymentToastId, phase]);

  const target = content?.kind === 'payment' ? content.target : undefined;
  const mintUrl = content?.kind === 'payment' ? content.mintUrl : undefined;
  const groupId = content?.kind === 'steps' ? content.groupId : undefined;
  const canOpen = (target !== undefined && mintUrl !== undefined) || groupId !== undefined;
  // Single-flight: a rapid double tap would otherwise read history twice and
  // stack two copies of the destination — `guardedRouter`'s debounce only
  // catches the navigation, not the lookup.
  const open = useSingleFlight(async () => {
    if (groupId !== undefined) {
      guardedRouter.push({ pathname: '/swap', params: { groupId } });
      hide();
      return;
    }
    if (target === undefined || mintUrl === undefined) return;
    // The toast stays up when nothing opened, so the tap is not swallowed
    // with nothing to show for it.
    if (await openToastTransaction(target, mintUrl)) hide();
  });
  const onOpen = () => void open();

  if (!view || !content || !phase) return null;

  const presented = presentPaymentToast(view, copy);
  const title =
    content.kind === 'payment' &&
    content.variant === 'receive-ecash' &&
    radarVisible &&
    phase === 'done'
      ? 'Received payment'
      : presented.title;
  const subtitle = presented.subtitle;
  const subtitleNode =
    subtitle === undefined || typeof subtitle === 'string' ? (
      subtitle
    ) : (
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {subtitle.map((segment, i) =>
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
              {segment}
            </RNText>
          )
        )}
      </View>
    );

  // The pill is shown once the payment is done; a failure leaves the right
  // side empty so the reason has room. The body opens it in every phase.
  const action =
    phase === 'done' && canOpen
      ? { label: 'View', onPress: onOpen, testID: 'payment-status-view' }
      : undefined;
  const probeVariant = content.kind === 'payment' ? content.variant : undefined;
  const selectorVariant =
    probeVariant === undefined
      ? 'swap'
      : probeVariant === 'receive-ecash'
        ? 'receive'
        : probeVariant;

  return (
    <>
      {probeVariant ? (
        <E2EPaymentToastRenderMarker
          variant={probeVariant}
          stage={presented.stage}
          {...(action ? { onView: action.onPress } : {})}
        />
      ) : null}
      <StatusToast
        status={presented.status}
        title={title}
        subtitle={subtitleNode}
        action={action}
        {...(canOpen ? { onPress: onOpen } : {})}
        statusTestID={`payment-status-${selectorVariant}-${presented.stage}`}
        toastProps={{ ...toastProps, hide, testID: 'payment-status-toast' }}
      />
    </>
  );
}
