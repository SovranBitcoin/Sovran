import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
} from '../../mint-capabilities';
import { logger, mintUrlFields } from '../../logger';
import type { MintMethodRequirement, WalletContext } from '../../types';
import type { FlowContext, FlowStep, StepDataMap } from '../types';

interface ReceiveFlowTransitionResult<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

function selectLightningMint(
  walletCtx: WalletContext,
  unit: string,
): string | null {
  const requirement: MintMethodRequirement = {
    operation: 'mint',
    method: 'bolt11',
    unit,
  };
  const candidates = buildMethodAwareMintCandidates(walletCtx, requirement);
  const preferred = walletCtx.preferredMintUrl;
  const selected =
    (preferred &&
    candidates.find((candidate) => candidate.mintUrl === preferred)?.status !==
      'disabled'
      ? preferred
      : candidates.find((candidate) => candidate.status !== 'disabled')
          ?.mintUrl) ?? null;
  logger.info('flow.receive.selectLightningMint', {
    unit,
    hasPreferredMintUrl: !!preferred,
    preferredMintUrlLength: preferred?.length ?? 0,
    candidateCount: candidates.length,
    enabledCandidateCount: candidates.filter(
      (candidate) => candidate.status !== 'disabled',
    ).length,
    hasSelectedMintUrl: !!selected,
    selectedMintUrlLength: selected?.length ?? 0,
  });
  return selected;
}

export function startReceiveLightningFlow(
  walletCtx: WalletContext,
  unit: string,
): ReceiveFlowTransitionResult<'enterAmount'> {
  logger.info('flow.receiveLightning.start', {
    unit,
    trustedMintCount: walletCtx.trustedMintUrls.length,
    hasPreferredMintUrl: !!walletCtx.preferredMintUrl,
    preferredMintUrlLength: walletCtx.preferredMintUrl?.length ?? 0,
    balanceMintCount: Object.keys(walletCtx.mintBalances).length,
  });
  const mintUrl = selectLightningMint(walletCtx, unit);
  const context: FlowContext = {
    unit,
    destination: 'mintQuote',
    mintUrl: mintUrl ?? '',
    mintQuoteMethod: 'bolt11',
  };

  logger.info('flow.receiveLightning.result', {
    unit,
    ...mintUrlFields(mintUrl),
    hasPreselectedMint: !!mintUrl,
    destination: context.destination,
    method: context.mintQuoteMethod,
  });
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

/** START_RECEIVE → the receive hub (QR Display / Scan QR / Fixed Amount / Paste). */
export function startReceiveFlow(
  walletCtx: WalletContext,
  unit: string,
): ReceiveFlowTransitionResult<'receiveHub'> {
  logger.info('flow.receiveHub.start', {
    unit,
    trustedMintCount: walletCtx.trustedMintUrls.length,
    balanceMintCount: Object.keys(walletCtx.mintBalances).length,
  });
  return {
    step: 'receiveHub',
    context: { unit },
    data: { unit, methodContext: createAmountEntryMethodContext(walletCtx) },
  };
}

/**
 * SHOW_RECEIVE_QR → the receive QR display (standing-rail tabs). Opens with a
 * clean `{unit}` context — same self-cleaning rule as the persist-only mint
 * scopes — so a stale destination from a backed-out Fixed Amount flow can't
 * resolve into an unexpected step later.
 */
export function startReceiveQrFlow(
  walletCtx: WalletContext,
  unit: string,
): ReceiveFlowTransitionResult<'navigateToReceive'> {
  logger.info('flow.receiveQr.start', {
    unit,
    trustedMintCount: walletCtx.trustedMintUrls.length,
    balanceMintCount: Object.keys(walletCtx.mintBalances).length,
  });
  return {
    step: 'navigateToReceive',
    context: { unit },
    data: { unit, methodContext: createAmountEntryMethodContext(walletCtx) },
  };
}
