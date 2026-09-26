import { apiLog } from '@/shared/lib/logger';

/**
 * What an AI payment bought, carried onto both of its ledger legs.
 *
 * A pay-per-request call is a send and a receive that mean one thing, so
 * history otherwise shows two unexplained movements. Annotating both with one
 * `groupId` pairs them the way a swap's legs are paired, and the message ids
 * tie the money to the exchange it paid for — the relationship a zap has to
 * its post.
 */
export interface PaymentContext {
  groupId: string;
  sessionId?: string;
  messageId?: string;
  model?: string;
}

/**
 * The AI payment the wallet adapter should attribute its next movement to.
 *
 * `@routstr/sdk` owns the spend now, and its `WalletAdapter` seam is four
 * plain methods with nowhere to thread a caller's context through. The send
 * and the change are also separated in time: the token goes out inside
 * `routeRequest`, the change comes back when the caller finalizes the stream.
 *
 * So the context is ambient, and the two windows are opened explicitly — once
 * around the request, once around the finalize — rather than left open for a
 * whole session. AI sends are single-flighted in the UI, so at most one window
 * is open at a time; `enter` says so out loud if that ever stops being true.
 */
let active: PaymentContext | null = null;

function enterPaymentScope(context: PaymentContext | undefined): void {
  if (active && context && active.groupId !== context.groupId) {
    apiLog.warn('routstr.payment.scope_overlap', {
      held: active.groupId,
      entering: context.groupId,
    });
  }
  active = context ?? null;
}

function exitPaymentScope(context: PaymentContext | undefined): void {
  if (!context || active?.groupId === context.groupId) active = null;
}

/** Run `fn` with `context` attributed to whatever the wallet moves inside it. */
export async function withPaymentScope<T>(
  context: PaymentContext | undefined,
  fn: () => Promise<T>
): Promise<T> {
  enterPaymentScope(context);
  try {
    return await fn();
  } finally {
    exitPaymentScope(context);
  }
}

/**
 * Label a wallet operation with the AI exchange that caused it.
 *
 * A no-op outside a payment scope, and never fatal: an unlabelled movement is
 * a worse history entry, not a failed payment.
 */
export function annotatePaymentLeg(leg: 'send' | 'receive', operationId: string): void {
  const context = active;
  if (!context) return;
  try {
    const { setTransactionAnnotation } =
      require('@/shared/stores/profile/transactionAnnotationStore') as typeof import('@/shared/stores/profile/transactionAnnotationStore');
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy graph boundary: the wallet must not be pulled into every Routstr consumer
    const { annotationKey } = require('wallet') as typeof import('wallet');
    setTransactionAnnotation(annotationKey({ type: leg, operationId }), {
      ai: {
        groupId: context.groupId,
        role: leg === 'send' ? 'payment' : 'change',
        ...(context.sessionId ? { sessionId: context.sessionId } : {}),
        ...(context.messageId ? { messageId: context.messageId } : {}),
        ...(context.model ? { model: context.model } : {}),
      },
    });
  } catch (error) {
    apiLog.warn('routstr.payment.annotate_failed', {
      leg,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
