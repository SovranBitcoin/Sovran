import { createAmountEntryMethodContext } from '../../mint-capabilities';
import { selectMint } from '../../mint-selection';
import type { WalletContext } from '../../types';
import type { PaymentCopyKey } from '../../copy';
import type {
  FlowContext,
  FlowStep,
  RecipientProfile,
  SendEntrySource,
  StepDataMap,
} from '../types';
import { logger, mintUrlFields } from '../../logger';
import { normalizeP2pkLock, type P2pkLockSpec } from '../../p2pk';

type SendFlowState =
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

type SendFlowAction = 'enterAmount' | 'selectMint' | 'showError';

interface SendFlowTransitionResult<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

interface StartSendEcashOptions {
  offline?: boolean;
  meltTarget?: string;
  recipientPubkey?: string;
  recipientProfile?: RecipientProfile;
  /** See `FlowContext.p2pkLockPubkey` — a bare key, kept for the Nut Drop callers. */
  p2pkLockPubkey?: string;
  /** See `FlowContext.p2pkLock` — supersedes `p2pkLockPubkey` when set. */
  p2pkLock?: P2pkLockSpec;
  /** See `SendEntrySource` — how this flow was entered (Create Ecash / scan / paste / contact). */
  entrySource?: SendEntrySource;
  /**
   * Constrain the source mint to this set (the intersection of our trusted
   * mints and the recipient's accepted mints, e.g. from a NUT-18 `creq`), so the
   * recipient can actually redeem the token. Passed to `selectMint`.
   */
  allowedMints?: string[];
}

interface SendFlowDefinition {
  initial: SendFlowState;
  start: (
    walletCtx: WalletContext,
    unit: string,
    opts?: StartSendEcashOptions,
  ) => SendFlowTransitionResult;
  actions: (state: SendFlowState) => readonly SendFlowAction[];
  copyKeys: (state: SendFlowState) => readonly PaymentCopyKey[];
}

/**
 * Open the Send method chooser — the "destination-first" send entry. Lands on
 * the `selectDestination` step so the wallet can present the send methods
 * (QR / Create Ecash / NFC / Nut Drop) plus a destination input + contact
 * search before any amount or mint is chosen. The method the user picks then
 * drives the rest of the flow through the existing entries (`startSendEcash`,
 * `execute`/`scan`, the Nut Drop route, etc.).
 */
export function startSendFlow(unit: string): SendFlowTransitionResult<'selectDestination'> {
  logger.info('flow.send.chooseDestination', { unit });
  return {
    step: 'selectDestination',
    context: { unit },
    data: { unit },
  };
}

export function startSendEcashFlow(
  walletCtx: WalletContext,
  unit: string,
  opts: StartSendEcashOptions = {},
): SendFlowTransitionResult {
  // The spec wins when both are given; the bare key is what the Nut Drop
  // callers still pass.
  const requestedLock = opts.p2pkLock ?? opts.p2pkLockPubkey;
  const lock = normalizeP2pkLock(requestedLock);
  logger.info('flow.sendEcash.start', {
    unit,
    offline: opts.offline === true,
    hasMeltTarget: !!opts.meltTarget,
    meltTargetLength: opts.meltTarget?.length ?? 0,
    hasRecipientPubkey: !!opts.recipientPubkey,
    recipientPubkeyLength: opts.recipientPubkey?.length ?? 0,
    hasRecipientProfile: !!opts.recipientProfile,
    p2pkLocked: !!lock,
    hasLocktime: !!lock?.locktimeSec,
    refundKeyCount: lock?.refundKeys?.length ?? 0,
    allowedMintCount: opts.allowedMints?.length ?? 0,
    trustedMintCount: walletCtx.trustedMintUrls.length,
    balanceMintCount: Object.keys(walletCtx.mintBalances).length,
  });
  const context: FlowContext = {
    unit,
    destination: 'sendEcash',
    offline: opts.offline,
    ...(opts.meltTarget ? { meltTarget: opts.meltTarget } : {}),
    ...(opts.recipientPubkey ? { recipientPubkey: opts.recipientPubkey } : {}),
    ...(opts.recipientProfile
      ? { recipientProfile: opts.recipientProfile }
      : {}),
    ...(lock ? { p2pkLock: lock, p2pkLockPubkey: lock.pubkey } : {}),
    ...(opts.entrySource ? { entrySource: opts.entrySource } : {}),
    // The recipient's accepted mints bind the WHOLE flow, not just the first
    // auto-pick: a later mint change (the amount screen's mint pill) must not
    // land on a mint they cannot redeem from — a P2PK-locked token from one is
    // unredeemable by them and unreclaimable by us.
    ...(opts.allowedMints?.length
      ? { supportedMintUrls: opts.allowedMints }
      : {}),
  };
  // A malformed lock must abort the flow — silently dropping it would
  // downgrade the send to a bearer token on whatever surface requested a lock.
  if (requestedLock && !lock) {
    logger.warn('flow.sendEcash.invalidP2pkLock', {
      hasLocktime: typeof requestedLock !== 'string' && !!requestedLock.locktimeSec,
      allowedMintCount: opts.allowedMints?.length ?? 0,
    });
    return {
      step: 'error',
      context,
      data: {
        code: 'INVALID_P2PK_LOCK',
        message: 'Invalid P2PK lock key for this send.',
      },
    };
  }
  const selection = selectMint(
    walletCtx,
    opts.allowedMints && opts.allowedMints.length > 0
      ? { allowedMints: opts.allowedMints }
      : {},
  );

  switch (selection.type) {
    case 'selected':
      context.mintUrl = selection.mintUrl;
      logger.info('flow.sendEcash.selectedMint', {
        unit,
        ...mintUrlFields(selection.mintUrl),
        offline: opts.offline === true,
        p2pkLocked: !!lock,
        allowedMintCount: opts.allowedMints?.length ?? 0,
      });
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
            ...(opts.recipientPubkey
              ? { recipientPubkey: opts.recipientPubkey }
              : {}),
            ...(opts.recipientProfile
              ? { recipientProfile: opts.recipientProfile }
              : {}),
            ...(context.p2pkLock
              ? {
                  p2pkLock: context.p2pkLock,
                  p2pkLockPubkey: context.p2pkLock.pubkey,
                }
              : {}),
            ...(opts.entrySource ? { entrySource: opts.entrySource } : {}),
          },
        },
      };
    case 'selectionNeeded':
      logger.info('flow.sendEcash.selectionNeeded', {
        unit,
        candidateCount: selection.validMints.length,
        offline: opts.offline === true,
        p2pkLocked: !!lock,
        allowedMintCount: opts.allowedMints?.length ?? 0,
      });
      return {
        step: 'selectMint',
        context,
        data: {
          candidates: selection.validMints,
          ...(context.supportedMintUrls
            ? { supportedMintUrls: context.supportedMintUrls }
            : {}),
          unit,
          destination: 'sendEcash',
          ...(opts.meltTarget ? { meltTarget: opts.meltTarget } : {}),
          ...(opts.recipientPubkey
            ? { recipientPubkey: opts.recipientPubkey }
            : {}),
          ...(opts.recipientProfile
            ? { recipientProfile: opts.recipientProfile }
            : {}),
        },
      };
    case 'noValidMint':
      logger.warn('flow.sendEcash.noValidMint', {
        unit,
        reasonCode: selection.reason.code,
        reasonMessage: selection.reason.message,
        offline: opts.offline === true,
        p2pkLocked: !!lock,
        allowedMintCount: opts.allowedMints?.length ?? 0,
      });
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
