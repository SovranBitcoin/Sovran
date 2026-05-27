import {
  createPaymentCopyResolver,
  type PaymentCopyKey,
  type PaymentCopyResolver,
} from '../copy';
import { isSendTokenCancelled, isSendTokenComplete } from './filters';

export type SendTokenReachabilityStatus =
  | 'checking'
  | 'device-offline'
  | 'mint-unreachable'
  | 'mint-reachable';

export interface SendTokenWarningCopy {
  title: string;
  description: string;
}

interface SendTokenStateEntry {
  state?: unknown;
}

interface SendTokenWarningCopyKeys {
  title: PaymentCopyKey;
  description: PaymentCopyKey;
}

export interface SendTokenReachabilityWarningOptions {
  mintWasOffline?: boolean;
  reachabilityStatus?: SendTokenReachabilityStatus;
  paymentCopy?: PaymentCopyResolver;
}

const DEFAULT_PAYMENT_COPY = createPaymentCopyResolver();

const SEND_TOKEN_WARNING_COPY = {
  mintOffline: {
    title: 'send.warning.mintOffline.title',
    description: 'send.warning.mintOffline.description',
  },
  deviceOffline: {
    title: 'send.warning.deviceOffline.title',
    description: 'send.warning.deviceOffline.description',
  },
  mintUnreachable: {
    title: 'send.warning.mintUnreachable.title',
    description: 'send.warning.mintUnreachable.description',
  },
} as const satisfies Record<string, SendTokenWarningCopyKeys>;

function isActiveSendToken(entry: SendTokenStateEntry | null | undefined): boolean {
  if (!entry) return false;
  return !isSendTokenComplete(entry) && !isSendTokenCancelled(entry);
}

function buildWarningCopy(
  copyKeys: SendTokenWarningCopyKeys,
  paymentCopy: PaymentCopyResolver,
): SendTokenWarningCopy {
  return {
    title: paymentCopy.text(copyKeys.title),
    description: paymentCopy.text(copyKeys.description),
  };
}

export function shouldShowMintOfflineWarning(
  entry: SendTokenStateEntry | null | undefined,
  mintWasOffline: boolean | undefined,
): boolean {
  return mintWasOffline === true && isActiveSendToken(entry);
}

export function getSendTokenReachabilityWarning(
  entry: SendTokenStateEntry | null | undefined,
  options: SendTokenReachabilityWarningOptions,
): SendTokenWarningCopy | null {
  const paymentCopy = options.paymentCopy ?? DEFAULT_PAYMENT_COPY;

  if (shouldShowMintOfflineWarning(entry, options.mintWasOffline)) {
    return buildWarningCopy(SEND_TOKEN_WARNING_COPY.mintOffline, paymentCopy);
  }

  if (!isActiveSendToken(entry)) return null;

  if (options.reachabilityStatus === 'device-offline') {
    return buildWarningCopy(SEND_TOKEN_WARNING_COPY.deviceOffline, paymentCopy);
  }

  if (options.reachabilityStatus === 'mint-unreachable') {
    return buildWarningCopy(SEND_TOKEN_WARNING_COPY.mintUnreachable, paymentCopy);
  }

  return null;
}
