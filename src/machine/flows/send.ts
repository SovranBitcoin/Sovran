import { createAmountEntryMethodContext } from '../../mint-capabilities';
import { selectMint } from '../../mint-selection';
import type { WalletContext } from '../../types';
import type { PaymentCopyKey } from '../../copy';
import type { FlowContext, FlowStep, RecipientProfile, StepDataMap } from '../types';

export type SendFlowState =
  | {
      type: 'enter-amount';
      unit: string;
      mintUrl: string;
      recipientPubkey?: string;
      recipientProfile?: RecipientProfile;
    }
  | {
      type: 'select-mint';
      unit: string;
      recipientPubkey?: string;
      recipientProfile?: RecipientProfile;
    }
  | { type: 'blocked'; unit: string; reason: string };

export type SendFlowAction = 'enterAmount' | 'selectMint' | 'showError';

export interface SendFlowTransitionResult<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

export interface StartSendEcashOptions {
  offline?: boolean;
  meltTarget?: string;
  recipientPubkey?: string;
  recipientProfile?: RecipientProfile;
  /** See `FlowContext.p2pkLockPubkey` — 33-byte compressed hex, `02`-prefixed. */
  p2pkLockPubkey?: string;
}

/** 33-byte compressed secp256k1 pubkey, `02`-prefixed per the Cashu↔Nostr convention. */
const P2PK_LOCK_PUBKEY_PATTERN = /^02[0-9a-f]{64}$/i;

export interface SendFlowDefinition {
  initial: SendFlowState;
  start: (
    walletCtx: WalletContext,
    unit: string,
    opts?: StartSendEcashOptions,
  ) => SendFlowTransitionResult;
  actions: (state: SendFlowState) => readonly SendFlowAction[];
  copyKeys: (state: SendFlowState) => readonly PaymentCopyKey[];
}

export function startSendEcashFlow(
  walletCtx: WalletContext,
  unit: string,
  opts: StartSendEcashOptions = {},
): SendFlowTransitionResult {
  const context: FlowContext = {
    unit,
    destination: 'sendEcash',
    offline: opts.offline,
    ...(opts.meltTarget ? { meltTarget: opts.meltTarget } : {}),
    ...(opts.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
    ...(opts.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
    ...(opts.p2pkLockPubkey ? { p2pkLockPubkey: opts.p2pkLockPubkey.toLowerCase() } : {}),
  };
  // A malformed lock key must abort the flow — silently dropping it would
  // downgrade the send to a bearer token on whatever surface requested a lock.
  if (opts.p2pkLockPubkey && !P2PK_LOCK_PUBKEY_PATTERN.test(opts.p2pkLockPubkey)) {
    return {
      step: 'error',
      context,
      data: {
        code: 'INVALID_P2PK_LOCK',
        message: 'Invalid P2PK lock key for this send.',
      },
    };
  }
  const selection = selectMint(walletCtx);

  switch (selection.type) {
    case 'selected':
      context.mintUrl = selection.mintUrl;
      return {
        step: 'enterAmount',
        context,
        data: {
          unit,
          preselectedMintUrl: selection.mintUrl,
          constraints: {
            destination: 'sendEcash',
            methodContext: createAmountEntryMethodContext(walletCtx),
            ...(opts.meltTarget ? { meltTarget: opts.meltTarget } : {}),
            ...(opts.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
            ...(opts.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
          },
        },
      };
    case 'selectionNeeded':
      return {
        step: 'selectMint',
        context,
        data: {
          candidates: selection.validMints,
          unit,
          destination: 'sendEcash',
          ...(opts.meltTarget ? { meltTarget: opts.meltTarget } : {}),
          ...(opts.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
          ...(opts.recipientProfile ? { recipientProfile: opts.recipientProfile } : {}),
        },
      };
    case 'noValidMint':
      return {
        step: 'error',
        context,
        data: { code: 'NO_BALANCE', message: selection.reason.message },
      };
  }
}

export const sendFlow: SendFlowDefinition = {
  initial: { type: 'select-mint', unit: 'sat' },
  start: startSendEcashFlow,
  actions: (state) => {
    switch (state.type) {
      case 'enter-amount':
        return ['enterAmount'];
      case 'select-mint':
        return ['selectMint'];
      case 'blocked':
        return ['showError'];
    }
  },
  copyKeys: (state) => {
    switch (state.type) {
      case 'enter-amount':
      case 'select-mint':
        return ['timeline.flow.send'];
      case 'blocked':
        return ['timeline.status.failed'];
    }
  },
};
