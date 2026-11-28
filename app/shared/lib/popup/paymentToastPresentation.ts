/**
 * What a payment toast says in each phase. Pure: the toast component only
 * draws the result. The title follows the payment's tense — under way while
 * it is `working`, done only once it is — so a toast never claims more than
 * the timeline does.
 */

import type { createPaymentCopyGroups } from 'wallet';

import type {
  PaymentToastContent,
  PaymentToastVariant,
  PaymentToastView,
} from '@/shared/stores/runtime/paymentStatusStore';

import { fmt, type PopupTextSegment } from './format';
import type { StatusToastStatus } from './StatusToast';

type ToastCopy = ReturnType<typeof createPaymentCopyGroups>['TOAST_COPY'];

/** Lifecycle names the device-test probes read (`payment-status-<variant>-<stage>`). */
type ToastStage = 'processing' | 'delivered' | 'warning' | 'confirmed' | 'failed';

const STAGE: Record<PaymentToastView['phase'], ToastStage> = {
  working: 'processing',
  'handed-off': 'delivered',
  slow: 'warning',
  done: 'confirmed',
  failed: 'failed',
};

const STATUS: Record<PaymentToastView['phase'], StatusToastStatus> = {
  working: 'pending',
  'handed-off': 'delivered',
  slow: 'warning',
  done: 'confirmed',
  failed: 'failed',
};

interface PaymentToastPresentation {
  status: StatusToastStatus;
  stage: ToastStage;
  title: string;
  subtitle?: string | PopupTextSegment[];
}

type PaymentContent = Extract<PaymentToastContent, { kind: 'payment' }>;

function paymentWording(
  phase: PaymentToastView['phase'],
  content: PaymentContent,
  copy: ToastCopy
): Pick<PaymentToastPresentation, 'title' | 'subtitle'> {
  const variant: PaymentToastVariant = content.variant;
  const own = copy[variant];
  const amount = { amount: content.amount, unit: content.unit };
  switch (phase) {
    case 'working':
      return { title: own.working, subtitle: own.processing };
    case 'handed-off':
      return {
        title: own.message,
        subtitle: 'handedOff' in own ? own.handedOff : copy.slow.subtitle,
      };
    case 'slow':
      return content.unconfirmed
        ? { title: copy.unconfirmed.title, subtitle: copy.unconfirmed.subtitle }
        : { title: copy.slow.title, subtitle: copy.slow.subtitle };
    case 'done':
      return {
        title: own.message,
        // A claim has no amount of its own to add: the request named it.
        subtitle: variant === 'payment-request' ? own.confirmed : fmt`${own.confirmed} ${amount}`,
      };
    case 'failed':
      return { title: own.failed };
  }
}

export function presentPaymentToast(
  view: Pick<PaymentToastView, 'phase' | 'content'>,
  copy: ToastCopy
): PaymentToastPresentation {
  const { phase, content } = view;
  const base = { status: STATUS[phase], stage: STAGE[phase] };
  if (content.kind === 'steps') {
    return {
      ...base,
      title: content.title,
      ...(content.subtitle !== undefined ? { subtitle: content.subtitle } : {}),
    };
  }
  const wording = paymentWording(phase, content, copy);
  const subtitle = content.subtitle ?? wording.subtitle;
  return {
    ...base,
    title: content.title ?? wording.title,
    ...(subtitle !== undefined ? { subtitle } : {}),
  };
}
