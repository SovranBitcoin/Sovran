import React, { useEffect } from 'react';
import { create } from 'zustand';

import { Pressable } from '@/shared/ui/primitives/Pressable';
import { View } from '@/shared/ui/primitives/View/View';

export type E2EPaymentToastVariant =
  | 'receive'
  | 'send'
  | 'melt'
  | 'receive-ecash'
  | 'payment-request';
export type E2EPaymentToastStage = 'processing' | 'delivered' | 'warning' | 'confirmed' | 'failed';

type PaymentToastProbe = {
  variant: E2EPaymentToastVariant;
  stage: E2EPaymentToastStage;
  onView?: () => void | Promise<void>;
  sequence: number;
};

type E2EToastProbeState = {
  key: string | null;
  sequence: number;
  payment: PaymentToastProbe | null;
  show: (key: string) => number;
  clear: (sequence: number) => void;
  showPayment: (payment: Omit<PaymentToastProbe, 'sequence'>) => number;
  clearPayment: (sequence: number) => void;
};

const useE2EToastProbeStore = create<E2EToastProbeState>((set, get) => ({
  key: null,
  sequence: 0,
  payment: null,
  show: (key) => {
    const sequence = get().sequence + 1;
    set({ key, sequence });
    return sequence;
  },
  clear: (sequence) => {
    if (get().sequence === sequence) set({ key: null });
  },
  showPayment: (payment) => {
    const sequence = get().sequence + 1;
    set({ payment: { ...payment, sequence }, sequence });
    return sequence;
  },
  clearPayment: (sequence) => {
    if (get().payment?.sequence === sequence) set({ payment: null });
  },
}));

let clearTimer: ReturnType<typeof setTimeout> | undefined;
const CONFIRMED_ACTION_RETAIN_MS = 15_000;
/** Static probes must outlive their toast: the harness's per-step evidence
 * capture (screenshot + AX + state sidecars) can spend several seconds between
 * the action that fired the toast and the waitFor that observes the probe. A
 * 5s window lost that race twice on live runs (2026-07-17); the probe is an
 * invisible 1×1 dev-only node, so retention costs nothing. */
const STATIC_TOAST_RETAIN_MS = 20_000;
const HIDDEN_PROBE_STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
} as const;
const HIDDEN_ACTION_STYLE = {
  ...HIDDEN_PROBE_STYLE,
  top: '50%',
} as const;

function showE2EStaticToastProbe(key: string, durationMs = 5_000): void {
  if (!__DEV__) return;
  if (clearTimer) clearTimeout(clearTimer);
  const sequence = useE2EToastProbeStore.getState().show(key);
  clearTimer = setTimeout(
    () => {
      useE2EToastProbeStore.getState().clear(sequence);
      clearTimer = undefined;
    },
    Math.max(STATIC_TOAST_RETAIN_MS, durationMs)
  );
}

/** Mark a static toast only after HeroUI has rendered its component.
 *
 * HeroUI toasts live in a FullWindowOverlay that iOS screenshots can see but
 * serve-sim AX cannot. The bridge mounts this marker beside the real toast
 * component, then the ordinary screen probe below mirrors only its closed key
 * into the app AX tree. No message, description, or payment value crosses this
 * DEV-only seam. */
export function E2EStaticToastRenderMarker({
  probeKey,
}: {
  probeKey?: string;
}): React.ReactElement | null {
  useEffect(() => {
    if (probeKey) showE2EStaticToastProbe(probeKey);
  }, [probeKey]);
  return null;
}

/** Mirror a dynamic payment toast into the ordinary app tree.
 *
 * HeroUI owns the visible FullWindowOverlay toast, while serve-sim observes the
 * ordinary React Native accessibility tree. This DEV-only marker publishes
 * closed lifecycle names and the existing View callback only. Payment ids,
 * amounts, mints, invoices, and copy never enter the bridge. */
export function E2EPaymentToastRenderMarker({
  variant,
  stage,
  onView,
}: {
  variant: E2EPaymentToastVariant;
  stage: E2EPaymentToastStage;
  onView?: () => void | Promise<void>;
}): React.ReactElement | null {
  useEffect(() => {
    if (!__DEV__) return;
    const sequence = useE2EToastProbeStore.getState().showPayment({
      variant,
      stage,
      ...(onView ? { onView } : {}),
    });
    return () => {
      if (stage === 'confirmed' && onView) {
        setTimeout(
          () => useE2EToastProbeStore.getState().clearPayment(sequence),
          CONFIRMED_ACTION_RETAIN_MS
        );
        return;
      }
      useE2EToastProbeStore.getState().clearPayment(sequence);
    };
  }, [onView, stage, variant]);
  return null;
}

export function E2EToastProbe(): React.ReactElement | null {
  const key = useE2EToastProbeStore((state) => state.key);
  const payment = useE2EToastProbeStore((state) => state.payment);
  const handleViewPress = React.useCallback(() => {
    if (!payment?.onView) return;
    useE2EToastProbeStore.getState().clearPayment(payment.sequence);
    void payment.onView();
  }, [payment]);
  if (!__DEV__ || (!key && !payment)) return null;
  const paymentVariant = payment?.variant === 'receive-ecash' ? 'receive' : payment?.variant;
  return (
    <>
      {key ? (
        <View
          testID={`e2e-toast-${key}`}
          accessible
          accessibilityRole="text"
          accessibilityLabel="Static toast visible"
          importantForAccessibility="yes"
          collapsable={false}
          pointerEvents="none"
          style={HIDDEN_PROBE_STYLE}
        />
      ) : null}
      {payment && paymentVariant ? (
        <>
          <View
            testID="payment-status-toast"
            accessible
            accessibilityRole="text"
            accessibilityLabel="Payment status visible"
            importantForAccessibility="yes"
            collapsable={false}
            pointerEvents="none"
            style={HIDDEN_PROBE_STYLE}
          />
          <View
            testID={`payment-status-${paymentVariant}-${payment.stage}`}
            accessible
            accessibilityRole="text"
            accessibilityLabel="Payment status stage"
            importantForAccessibility="yes"
            collapsable={false}
            pointerEvents="none"
            style={HIDDEN_PROBE_STYLE}
          />
          {payment.onView ? (
            <Pressable
              testID="payment-status-view"
              accessible
              accessibilityRole="button"
              accessibilityLabel="View payment transaction"
              importantForAccessibility="yes"
              collapsable={false}
              onPress={handleViewPress}
              style={HIDDEN_ACTION_STYLE}
            />
          ) : null}
        </>
      ) : null}
    </>
  );
}
