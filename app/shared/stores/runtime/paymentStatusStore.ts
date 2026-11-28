/**
 * The transaction toasts on screen. One toast per payment, keyed by the
 * payment (`toastKey`), updated in place; all phase and timing rules are the
 * pure machine's (`paymentToastMachine`). Callers report what they know about
 * a payment through `paymentToasts`; the toast stack draws `toasts`.
 *
 * Session-scoped and never persisted.
 */

import { defineStore as create } from '@/shared/lib/persist/defineStore';

import { paymentLog } from '@/shared/lib/logger';
import { createPaymentToastMachine, type ToastView } from '@/shared/lib/popup/paymentToastMachine';

export type PaymentToastVariant = 'receive' | 'send' | 'melt' | 'receive-ecash' | 'payment-request';

/**
 * How to find a toast's transaction in history: only ever ids the wallet
 * issued, never the starter's local key. Absent until one is known.
 */
export type PaymentToastTarget =
  | { type: 'mint' | 'melt'; quoteId: string }
  | { type: 'send'; operationId: string }
  | { type: 'receive'; entryId?: string; operationId?: string };

export type PaymentToastContent =
  | {
      kind: 'payment';
      variant: PaymentToastVariant;
      mintUrl: string;
      amount: number;
      unit: string;
      target?: PaymentToastTarget;
      /** Wording that replaces the phase's own (a failure reason, what a wait is for). */
      title?: string;
      subtitle?: string;
      /** Its result is not known (it may still complete): worded as that, not as slow. */
      unconfirmed?: boolean;
    }
  | {
      /** A payment in steps (swap, rebalance): the wording is the current step's. */
      kind: 'steps';
      title: string;
      subtitle?: string;
      /** SwapTransactions group, for opening it. */
      groupId?: string;
    };

export type PaymentToastView = ToastView<PaymentToastContent>;

/** The key of a payment's toast: the id every wallet event of that payment carries. */
export const toastKey = {
  melt: (quoteId: string) => `melt:${quoteId}`,
  mint: (quoteId: string) => `mint:${quoteId}`,
  send: (operationId: string) => `send:${operationId}`,
  receive: (id: string) => `receive:${id}`,
  swap: (id: string) => `swap:${id}`,
  /** Started before the wallet issued an id: a key only its starter holds, until `bind`. */
  pending: (localId: string) => `pending:${localId}`,
};

type PaymentStatusStore = {
  /** The toasts to draw, oldest first. */
  toasts: PaymentToastView[];
};

export const usePaymentStatusStore = create<PaymentStatusStore>({
  name: 'usePaymentStatusStore',
  scope: 'session',
})(() => ({ toasts: [] }));

/** The e2e harness cannot screenshot inside the 3 s result window (per-step
 * evidence capture alone costs ~1 s), so its owned Metro slows results via env.
 * Unset outside e2e dev sessions. */
const E2E_DISMISS_MS = __DEV__ ? Number(process.env.EXPO_PUBLIC_E2E_TOAST_DISMISS_MS) : NaN;

export const paymentToasts = createPaymentToastMachine<PaymentToastContent>({
  ...(Number.isFinite(E2E_DISMISS_MS) && E2E_DISMISS_MS > 0
    ? { timing: { resultMs: E2E_DISMISS_MS } }
    : {}),
  // A result that arrived before its toast knew which payment it was: the
  // toast keeps saying what it is (a payment request stays one) and gains the
  // result's way to open the transaction.
  merge: (own, early) =>
    own.kind === 'payment' && early.kind === 'payment'
      ? {
          kind: 'payment',
          variant: own.variant,
          mintUrl: own.mintUrl,
          amount: own.amount,
          unit: own.unit,
          ...((early.target ?? own.target) ? { target: early.target ?? own.target } : {}),
        }
      : early,
  onChange: (toasts) => {
    paymentLog.info('payment.toast.changed', {
      toasts: toasts.map((toast) => `${toast.key.split(':')[0]}:${toast.phase}`),
    });
    usePaymentStatusStore.setState({ toasts });
  },
});

let focusedToken: string | null = null;

/**
 * A transaction's screen is in front: its toasts stay quiet until the returned
 * function is called (the screen blurred). `token` names the screen instance,
 * so the entry it shows may change (a preview becoming a payment) without the
 * toast of a payment started from it showing in between.
 */
export function focusTransaction(token: string, ids: readonly string[]): () => void {
  focusedToken = token;
  paymentToasts.setFocus({ token, ids });
  return () => {
    // Another screen has taken the front since: it is not this one's to clear.
    if (focusedToken !== token) return;
    focusedToken = null;
    paymentToasts.setFocus(null);
  };
}
