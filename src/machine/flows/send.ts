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
}

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
  };
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
