import type {
  BasePaymentContext,
  SendTokenContext,
} from './types';

// ---------------------------------------------------------------------------
// Amount & balance
// ---------------------------------------------------------------------------

export const isAmountValid = ({
  context,
}: {
  context: BasePaymentContext;
}): boolean => Number.isFinite(context.amount) && context.amount > 0;

export const isMintSelected = ({
  context,
}: {
  context: BasePaymentContext;
}): boolean => !!context.mintUrl;

export const isBalanceSufficient = ({
  context,
}: {
  context: BasePaymentContext;
}): boolean => context.mintBalance >= context.amount;

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

export const isOffline = ({
  context,
}: {
  context: BasePaymentContext;
}): boolean => context.isOffline === true;

export const isExactOfflineAmount = ({
  context,
}: {
  context: SendTokenContext;
}): boolean => {
  if (!context.offlineSendability) return false;
  return context.offlineSendability.reachableSums.includes(context.amount);
};
