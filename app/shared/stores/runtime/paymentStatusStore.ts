import { defineStore as create } from '@/shared/lib/persist/defineStore';

import { describeError } from '@/shared/lib/errors';
import { paymentLog } from '@/shared/lib/logger';

type PaymentStatusState = 'processing' | 'delivered' | 'waiting' | 'confirmed' | 'failed';

/**
 * The payment a send, melt or payment-request toast belongs to. A wallet
 * event changes the toast only when it is for this payment.
 */
type PaymentToastOwner =
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

function sameOwner(a: BoundOwner, b: BoundOwner): boolean {
  switch (a.kind) {
    case 'melt':
      return b.kind === 'melt' && b.quoteId === a.quoteId;
    case 'send':
      return b.kind === 'send' && b.operationId === a.operationId;
  }
}

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

/** Whether `active` is the toast of this melt (by its quote). */
export function ownsMelt(active: ActivePaymentStatus | null, quoteId: string): boolean {
  const owner = ownerOf(active);
  return owner?.kind === 'melt' && owner.quoteId === quoteId;
}

type OwnedVariant = 'send' | 'melt' | 'payment-request';

/**
 * Whether `active` is the toast of a `variants` payment still in flight. An
 * event for another payment neither changes nor replaces it: the person is
 * watching this one, and its own events or its starter end it.
 */
function paymentInFlight(
  active: ActivePaymentStatus | null,
  variants: readonly OwnedVariant[]
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

/**
 * A send or melt that finished, with the toast it gets when it is shown on
 * its own. While a toast whose payment was not yet known is in flight, it may
 * be that toast's own, so it is held: the toast catches up with it once its
 * flow binds it to that payment. Otherwise it is another payment's, and gets
 * `toast` once the toast on screen ends.
 */
interface PaymentResult {
  owner: BoundOwner;
  /** The melt or send operation, for View. */
  operationId: string;
  toast: ActivePaymentStatus;
}

interface HeldResult extends PaymentResult {
  /** The key of the toast that was waiting to be bound when it was held, if one was. */
  heldWhileWaiting: string | null;
}

/**
 * Results held at once, oldest dropped first, except those held while the
 * toast still on screen waited to be bound: one of them may be its own, and
 * they are kept, past the limit if need be, for as long as it waits.
 */
const MAX_HELD_RESULTS = 20;

/** Results remembered as shown, so one delivered again is not shown again. */
const MAX_SHOWN_RESULTS = 20;

/** What became of a finished payment's result. */
type ResultDelivery =
  /** It confirmed the toast on screen, which is its own. */
  | 'confirmed'
  /** It waits for the toast in flight to be bound or to end. */
  | 'held'
  /** It is on screen in a toast of its own. */
  | 'shown'
  /** It was shown before, and is not shown again. */
  | 'alreadyShown';

/** The key of the toast on screen while it waits to be bound to its payment. */
function waitingKey(active: ActivePaymentStatus | null): string | null {
  const owner = ownerOf(active);
  return owner?.kind === 'pending' ? owner.key : null;
}

function withHeld(
  held: readonly HeldResult[],
  result: PaymentResult,
  waiting: string | null
): HeldResult[] {
  const next = [
    ...held.filter((h) => !sameOwner(h.owner, result.owner)),
    { ...result, heldWhileWaiting: waiting },
  ];
  let excess = next.length - MAX_HELD_RESULTS;
  if (excess <= 0) return next;
  return next.filter((h) => {
    const mayBeTheWaitingToasts = waiting !== null && h.heldWhileWaiting === waiting;
    if (excess <= 0 || mayBeTheWaitingToasts) return true;
    excess -= 1;
    return false;
  });
}

function withShown(shown: readonly BoundOwner[], owner: BoundOwner): BoundOwner[] {
  return [...shown.filter((o) => !sameOwner(o, owner)), owner].slice(-MAX_SHOWN_RESULTS);
}

type PaymentStatusStore = {
  active: ActivePaymentStatus | null;
  held: HeldResult[];
  /** Results shown, newest last: enough to know one delivered again. */
  shown: BoundOwner[];
  /**
   * A send or melt finished: confirm its own toast on screen, hold it while
   * another of `inFlight` is in flight, or show it in a toast of its own. A
   * result is shown once, and showing it uses up its held copy.
   */
  deliverResult: (result: PaymentResult, inFlight: readonly OwnedVariant[]) => ResultDelivery;
  /** With no toast on screen, show the oldest held result's toast; null when there is none. */
  takeHeld: () => PaymentResult | null;
  setActive: (payment: ActivePaymentStatus | null) => void;
  clearActive: (id?: string) => void;
  /**
   * Bind the toast its starter opened under `key` to the payment's id, once
   * it is known. A result already held for that payment confirms it.
   */
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

/**
 * `s` with the toast `id` confirmed, merging `extra` into one already
 * confirmed; `s` itself when it is another toast, or is waiting or failed.
 */
function confirmActive(
  s: { active: ActivePaymentStatus | null },
  id: string,
  extra?: { operationId?: string; receiveEntryId?: string }
): { active: ActivePaymentStatus | null } {
  if (s.active?.id !== id) {
    logSkip('payment.status.confirmed.skipped', s, id, 'id_mismatch');
    return s;
  }
  if (s.active.state === 'confirmed') {
    // Already confirmed — only merge extra data (operationId, receiveEntryId)
    paymentLog.debug('payment.status.confirmed.merge_extra', { id, hasExtra: !!extra });
    return extra ? { active: { ...s.active, ...extra } } : s;
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
    active: { ...withoutStatusCopy(s.active), state: 'confirmed' as const, ...extra },
  };
}

export const usePaymentStatusStore = create<PaymentStatusStore>({
  name: 'usePaymentStatusStore',
  scope: 'session',
})((set) => ({
  active: null,
  held: [],
  shown: [],
  deliverResult: (result, inFlight) => {
    let delivery: ResultDelivery = 'alreadyShown';
    set((s) => {
      const { owner } = result;
      const current = ownerOf(s.active);
      const held = s.held.filter((h) => !sameOwner(h.owner, owner));
      if (s.active && current && current.kind !== 'pending' && sameOwner(current, owner)) {
        delivery = 'confirmed';
        const next = confirmActive(s, s.active.id, { operationId: result.operationId });
        if (next.active?.state !== 'confirmed') return next;
        return { ...next, held, shown: withShown(s.shown, owner) };
      }
      if (s.shown.some((o) => sameOwner(o, owner))) {
        delivery = 'alreadyShown';
        return s;
      }
      if (paymentInFlight(s.active, inFlight)) {
        delivery = 'held';
        paymentLog.info('payment.status.hold_result', {
          owner: owner.kind,
          held: held.length + 1,
        });
        return { held: withHeld(s.held, result, waitingKey(s.active)) };
      }
      delivery = 'shown';
      return { active: result.toast, held, shown: withShown(s.shown, owner) };
    });
    return delivery;
  },
  takeHeld: () => {
    let taken: PaymentResult | null = null;
    set((s) => {
      const [next, ...rest] = s.held;
      if (s.active || !next) return s;
      taken = next;
      paymentLog.info('payment.status.show_held_result', {
        variant: next.toast.variant,
        id: next.toast.id,
        stillHeld: rest.length,
      });
      return { active: next.toast, held: rest, shown: withShown(s.shown, next.owner) };
    });
    return taken;
  },
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
      const result = s.held.find((h) => sameOwner(h.owner, owner));
      paymentLog.info('payment.status.bind_owner', {
        id: active.id,
        variant: active.variant,
        owner: owner.kind,
        caughtUp: !!result,
      });
      if (!result) return { active: { ...active, owner } };
      const held = s.held.filter((h) => h !== result);
      // Its payment finished before the toast knew it: it is confirmed now,
      // unless it already ended or is waiting on the person.
      if (active.state !== 'processing' && active.state !== 'delivered') {
        return { active: { ...active, owner }, held };
      }
      return {
        active: {
          ...withoutStatusCopy(active),
          owner,
          state: 'confirmed' as const,
          operationId: result.operationId,
        },
        held,
        shown: withShown(s.shown, owner),
      };
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
  setConfirmed: (id, extra) => set((s) => confirmActive(s, id, extra)),
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
