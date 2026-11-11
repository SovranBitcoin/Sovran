import { defineStore as create } from '@/shared/lib/persist/defineStore';

import { describeError } from '@/shared/lib/errors';
import { paymentLog } from '@/shared/lib/logger';

type PaymentStatusState = 'processing' | 'delivered' | 'waiting' | 'confirmed' | 'failed';

/**
 * The payment a send, melt or payment-request toast belongs to. A wallet
 * event changes the toast only when it is for this payment.
 */
export type PaymentToastOwner =
  /**
   * Started before the wallet issued an id for it: a key only its starter
   * holds, bound to the payment's id when the starter learns it.
   */
  | { kind: 'pending'; key: string }
  /** A melt, by its quote: every event of the melt carries it. */
  | { kind: 'melt'; quoteId: string }
  /** A send (plain ecash, or a payment request's), by its operation. */
  | { kind: 'send'; operationId: string };

type BoundOwner = Exclude<PaymentToastOwner, { kind: 'pending' }>;

interface PaymentStatusFields {
  /** The toast's handle (what its popup clears): quoteId, operationId, entry id or the starter's key. */
  id: string;
  mintUrl: string;
  amount: number;
  unit: string;
  state: PaymentStatusState;
  /** For melt: set when melt-op:finalized fires, used for View button */
  operationId?: string;
  /** For receive-ecash: set when receive:created fires, used for View button */
  receiveEntryId?: string;
  /** User-friendly reason when state is 'failed' */
  errorMessage?: string;
  /** Optional title override while the payment is still pending. */
  titleOverride?: string;
  /** Optional subtitle override while the payment is still pending. */
  subtitleOverride?: string;
}

type ActivePaymentStatus = PaymentStatusFields &
  (
    | { variant: 'receive' | 'receive-ecash' }
    | { variant: 'send' | 'melt' | 'payment-request'; owner: PaymentToastOwner }
  );

/** The payment a toast belongs to; null for a receive toast, which has none. */
function ownerOf(active: ActivePaymentStatus | null): PaymentToastOwner | null {
  if (!active) return null;
  switch (active.variant) {
    case 'send':
    case 'melt':
    case 'payment-request':
      return active.owner;
    case 'receive':
    case 'receive-ecash':
      return null;
  }
}

/** Whether `active` is the toast of this send (by its operation). */
export function ownsSend(active: ActivePaymentStatus | null, operationId: string): boolean {
  const owner = ownerOf(active);
  return owner?.kind === 'send' && owner.operationId === operationId;
}

/** Whether `active` is the toast of this melt (by its quote). */
export function ownsMelt(active: ActivePaymentStatus | null, quoteId: string): boolean {
  const owner = ownerOf(active);
  return owner?.kind === 'melt' && owner.quoteId === quoteId;
}

/**
 * Whether `active` is the toast of a `variants` payment still in flight. An
 * event for another payment neither changes nor replaces it: the person is
 * watching this one, and its own events or its starter end it.
 */
export function paymentInFlight(
  active: ActivePaymentStatus | null,
  variants: readonly ('send' | 'melt' | 'payment-request')[]
): boolean {
  if (active?.state !== 'processing') return false;
  switch (active.variant) {
    case 'send':
    case 'melt':
    case 'payment-request':
      return variants.includes(active.variant);
    case 'receive':
    case 'receive-ecash':
      return false;
  }
}

type PaymentStatusStore = {
  active: ActivePaymentStatus | null;
  setActive: (payment: ActivePaymentStatus | null) => void;
  clearActive: (id?: string) => void;
  /** Bind the toast its starter opened under `key` to the payment's id, once it is known. */
  bindOwner: (key: string, owner: BoundOwner) => void;
  setWaiting: (id: string, copy: { title: string; subtitle: string }) => void;
  setDelivered: (id: string) => void;
  setConfirmed: (id: string, extra?: { operationId?: string; receiveEntryId?: string }) => void;
  /** `text`, when given, is shown as is; otherwise the error is described from the catalogue. */
  setFailed: (id: string, error?: unknown, text?: string) => void;
};

/** Debug-log a refused transition; call sites keep their literal event keys. */
function logSkip(
  event: string,
  s: { active: ActivePaymentStatus | null },
  requestedId: string,
  reason: string
): void {
  paymentLog.debug(event, {
    requestedId,
    activeId: s.active?.id ?? null,
    activeState: s.active?.state ?? null,
    reason,
  });
}

function withoutStatusCopy(active: ActivePaymentStatus): ActivePaymentStatus {
  const next = { ...active };
  delete next.titleOverride;
  delete next.subtitleOverride;
  return next;
}

export const usePaymentStatusStore = create<PaymentStatusStore>({
  name: 'usePaymentStatusStore',
  scope: 'session',
})((set) => ({
  active: null,
  setActive: (payment) => {
    set((s) => {
      paymentLog.info(
        'payment.status.set_active',
        payment
          ? {
              variant: payment.variant,
              id: payment.id,
              state: payment.state,
              amount: payment.amount,
              unit: payment.unit,
              previousId: s.active?.id ?? null,
              previousState: s.active?.state ?? null,
            }
          : {
              cleared: true,
              previousId: s.active?.id ?? null,
              previousState: s.active?.state ?? null,
            }
      );
      return { active: payment };
    });
  },
  clearActive: (id) =>
    set((s) => {
      if (id !== undefined && s.active?.id !== id) {
        logSkip('payment.status.clear_active.skipped', s, id, 'id_mismatch');
        return s;
      }
      paymentLog.info('payment.status.clear_active', {
        id: s.active?.id ?? null,
        from: s.active?.state ?? null,
        requestedId: id ?? null,
      });
      return { active: null };
    }),
  bindOwner: (key, owner) =>
    set((s) => {
      const active = s.active;
      const current = ownerOf(active);
      if (!active || current?.kind !== 'pending' || current.key !== key) {
        logSkip('payment.status.bind_owner.skipped', s, key, 'not_pending_for_key');
        return s;
      }
      paymentLog.info('payment.status.bind_owner', {
        id: active.id,
        variant: active.variant,
        owner: owner.kind,
      });
      return { active: { ...active, owner } };
    }),
  setWaiting: (id, copy) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.waiting.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (s.active.state === 'confirmed' || s.active.state === 'failed') {
        logSkip('payment.status.waiting.skipped', s, id, 'terminal_state');
        return s;
      }
      paymentLog.info('payment.status.waiting', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'waiting',
        expectedNext: 'terminal_warning_toast_then_later_success_toast',
      });
      return {
        active: {
          ...s.active,
          state: 'waiting' as const,
          titleOverride: copy.title,
          subtitleOverride: copy.subtitle,
        },
      };
    }),
  setDelivered: (id) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.delivered.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (
        s.active.state === 'waiting' ||
        s.active.state === 'confirmed' ||
        s.active.state === 'failed'
      ) {
        logSkip('payment.status.delivered.skipped', s, id, 'terminal_or_waiting_state');
        return s;
      }
      paymentLog.info('payment.status.delivered', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'delivered',
      });
      return { active: { ...s.active, state: 'delivered' as const } };
    }),
  setConfirmed: (id, extra) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.confirmed.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (s.active.state === 'confirmed') {
        // Already confirmed — only merge extra data (operationId, receiveEntryId)
        paymentLog.debug('payment.status.confirmed.merge_extra', { id, hasExtra: !!extra });
        return extra ? { active: { ...s.active!, ...extra } } : s;
      }
      if (s.active.state === 'waiting') {
        paymentLog.debug('payment.status.confirmed.skip_waiting', { id });
        return s;
      }
      if (s.active.state === 'failed') {
        paymentLog.debug('payment.status.confirmed.skip_failed', { id });
        return s;
      }
      paymentLog.info('payment.status.confirmed', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'confirmed',
        hasOperationId: !!extra?.operationId,
        hasReceiveEntryId: !!extra?.receiveEntryId,
      });
      return {
        active: { ...withoutStatusCopy(s.active!), state: 'confirmed' as const, ...extra },
      };
    }),
  setFailed: (id, error, text) =>
    set((s) => {
      if (s.active?.id !== id) {
        logSkip('payment.status.failed.skipped', s, id, 'id_mismatch');
        return s;
      }
      if (
        s.active.state === 'waiting' ||
        s.active.state === 'failed' ||
        s.active.state === 'confirmed'
      ) {
        logSkip('payment.status.failed.skipped', s, id, 'terminal_or_waiting_state');
        return s;
      }
      const errorMessage =
        text ?? (error !== undefined ? describeError(error, 'cashu').text : undefined);
      paymentLog.error('payment.status.failed', {
        id,
        variant: s.active.variant,
        from: s.active.state,
        to: 'failed',
        errorMessage,
      });
      return {
        active: { ...withoutStatusCopy(s.active!), state: 'failed' as const, errorMessage },
      };
    }),
}));
