import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
} from '../../mint-capabilities';
import type { MintMethodRequirement, WalletContext } from '../../types';
import type { PaymentCopyKey } from '../../copy';
import type { FlowContext, FlowStep, MintQuoteMethod, StepDataMap } from '../types';

export type ReceiveFlowState =
  | {
      type: 'enter-lightning-amount';
      unit: string;
      mintUrl: string | null;
      method: MintQuoteMethod;
    }
  | { type: 'receive-hub'; unit: string };

export type ReceiveFlowEvent =
  | { type: 'START_RECEIVE_LIGHTNING'; unit: string }
  | { type: 'START_RECEIVE'; unit: string };

export type ReceiveFlowAction = 'enterAmount' | 'showReceiveHub';

export interface ReceiveFlowTransitionResult<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

export interface ReceiveFlowDefinition {
  initial: ReceiveFlowState;
  transition: (
    event: ReceiveFlowEvent,
    walletCtx: WalletContext,
  ) => ReceiveFlowTransitionResult;
  actions: (state: ReceiveFlowState) => readonly ReceiveFlowAction[];
  copyKeys: (state: ReceiveFlowState) => readonly PaymentCopyKey[];
}

function selectLightningMint(walletCtx: WalletContext, unit: string): string | null {
  const requirement: MintMethodRequirement = { operation: 'mint', method: 'bolt11', unit };
  const candidates = buildMethodAwareMintCandidates(walletCtx, requirement);
  const preferred = walletCtx.preferredMintUrl;
  return (
    (preferred &&
    candidates.find((candidate) => candidate.mintUrl === preferred)?.status !== 'disabled'
      ? preferred
      : candidates.find((candidate) => candidate.status !== 'disabled')?.mintUrl) ?? null
  );
}

export function startReceiveLightningFlow(
  walletCtx: WalletContext,
  unit: string,
): ReceiveFlowTransitionResult<'enterAmount'> {
  const mintUrl = selectLightningMint(walletCtx, unit);
  const context: FlowContext = {
    unit,
    destination: 'mintQuote',
    mintUrl: mintUrl ?? '',
    mintQuoteMethod: 'bolt11',
  };

  return {
    step: 'enterAmount',
    context,
    data: {
      unit,
      preselectedMintUrl: mintUrl ?? undefined,
      constraints: {
        destination: 'mintQuote',
        methodContext: createAmountEntryMethodContext(walletCtx),
      },
    },
  };
}

export function startReceiveFlow(
  walletCtx: WalletContext,
  unit: string,
): ReceiveFlowTransitionResult<'navigateToReceive'> {
  return {
    step: 'navigateToReceive',
    context: { unit },
    data: { unit, methodContext: createAmountEntryMethodContext(walletCtx) },
  };
}

export const receiveFlow: ReceiveFlowDefinition = {
  initial: { type: 'receive-hub', unit: 'sat' },
  transition: (event, walletCtx) =>
    event.type === 'START_RECEIVE_LIGHTNING'
      ? startReceiveLightningFlow(walletCtx, event.unit)
      : startReceiveFlow(walletCtx, event.unit),
  actions: (state) => (state.type === 'receive-hub' ? ['showReceiveHub'] : ['enterAmount']),
  copyKeys: (state) =>
    state.type === 'receive-hub'
      ? ['timeline.flow.receive']
      : ['timeline.mint.unpaid.label', 'timeline.mint.unpaid.info'],
};
