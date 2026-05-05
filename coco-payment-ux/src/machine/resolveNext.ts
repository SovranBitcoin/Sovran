import type { LocalizedReason } from '../formatting/locales';
import { logger } from '../logger';
import { selectMint } from '../mint-selection';
import { composeSatoshis } from '../offline';
import type { ResolvedIntent, WalletContext } from '../types';
import type { Destination, ErrorCode, FlowContext, FlowStep, StepDataMap } from './types';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface StepResult<S extends FlowStep = FlowStep> {
  step: S;
  data: StepDataMap[S];
  /** Updated context fields to merge (e.g. auto-selected mintUrl). */
  contextPatch?: Partial<FlowContext>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorResult(code: ErrorCode, message: string): StepResult<'error'> {
  return { step: 'error', data: { code, message } };
}

function toMintError(reason: LocalizedReason): StepResult<'error'> {
  switch (reason.code) {
    case 'INSUFFICIENT_BALANCE':
    case 'INSUFFICIENT_BALANCE_ALLOWED':
      return errorResult('INSUFFICIENT_BALANCE', reason.message);
    case 'NO_BALANCE':
    case 'NO_MINT_SUFFICIENT_BALANCE':
      return errorResult('NO_BALANCE', reason.message);
    default:
      return errorResult('NO_VALID_MINT', reason.message);
  }
}

function getDestination(intent: ResolvedIntent, ctx: FlowContext): Destination {
  if (ctx.destination) return ctx.destination;
  switch (intent.type) {
    case 'sendPaymentRequest':
      return 'paymentRequest';
    case 'meltLightningInvoice':
    case 'meltLightningAddress':
    case 'meltLnurlp':
      return 'meltQuote';
    default:
      return 'sendEcash';
  }
}

function needsAmount(destination: Destination, ctx: FlowContext): boolean {
  return ctx.amount == null || ctx.amount <= 0;
}

/**
 * For mintQuote (receive), any trusted mint works -- no balance needed.
 * For send/melt, we need a mint with sufficient balance.
 */
function needsSpendableBalance(destination: Destination): boolean {
  return destination !== 'mintQuote';
}

function isMintValidForFlow(
  mintUrl: string,
  walletCtx: WalletContext,
  amount: number | undefined,
  supportedMintUrls: string[] | undefined,
  destination: Destination
): boolean {
  if (!walletCtx.trustedMintUrls.includes(mintUrl)) return false;
  if (supportedMintUrls?.length && !supportedMintUrls.includes(mintUrl)) return false;
  if (!needsSpendableBalance(destination)) return true;
  const balance = walletCtx.mintBalances[mintUrl] ?? 0;
  if (amount != null && amount > 0) return balance >= amount;
  return balance > 0;
}

// ---------------------------------------------------------------------------
// Proof composition check
// ---------------------------------------------------------------------------

function checkProofComposition(
  walletCtx: WalletContext,
  mintUrl: string,
  amount: number,
  unit: string,
  ctx: FlowContext
): StepResult<'chooseProofs'> | null {
  // Only show proof selector for ecash sends. Lightning melts and payment
  // requests must always attempt the exact amount — the mint handles the
  // swap server-side, so showing a proof picker is incorrect.
  if (ctx.destination !== 'sendEcash') return null;

  const proofAmounts = walletCtx.proofAmounts[mintUrl] ?? [];
  if (proofAmounts.length === 0) return null;

  // Online: always skip the proof selector — the mint handles swaps
  // server-side via executeSend. If executeSend fails, the catch block
  // in createMachine falls back to chooseProofs.
  if (!ctx.offline) return null;

  // Offline: always show the proof selector since the mint is unreachable.
  const composition = composeSatoshis(proofAmounts, amount);

  return {
    step: 'chooseProofs',
    data: {
      mintUrl,
      amount,
      unit,
      proofAmounts,
      suggestions: {
        roundDown: composition.exactMatch
          ? { amount }
          : composition.nearestLower != null
            ? { amount: composition.nearestLower }
            : null,
        roundUp: composition.exactMatch
          ? null
          : composition.nearestUpper != null
            ? { amount: composition.nearestUpper }
            : null,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Terminal step builders
// ---------------------------------------------------------------------------

function terminalStep(destination: Destination, ctx: FlowContext): StepResult {
  logger.info('resolveNext.terminal', {
    destination,
    mintUrl: ctx.mintUrl,
    amount: ctx.amount,
  });
  const { mintUrl, amount, unit, meltTarget, recipientPubkey } = ctx;

  switch (destination) {
    case 'mintQuote':
      return {
        step: 'createMintQuote',
        data: { mintUrl: mintUrl!, amount: amount!, unit },
      };
    case 'meltQuote':
      return {
        step: 'navigateToMeltPreview',
        data: {
          mintUrl: mintUrl!,
          meltTarget: meltTarget!,
          unit,
          amount: amount!,
          recipientPubkey,
        },
      };
    case 'paymentRequest':
      return {
        step: 'navigateToPaymentRequest',
        data: {
          mintUrl: mintUrl!,
          paymentRequest: ctx.paymentRequest!,
          amount: amount!,
          unit,
          recipientPubkey,
        },
      };
    case 'sendEcash':
      return {
        step: 'confirmSend',
        data: { mintUrl: mintUrl!, amount: amount! },
      };
  }
}

// ---------------------------------------------------------------------------
// resolveNext — the single routing function
// ---------------------------------------------------------------------------

/**
 * Given a resolved intent and accumulated context, determines the next step.
 *
 * Priority order:
 * 1. Terminal intents (receiveToken, openMint, openProfile, ignore)
 * 2. Multi-option (chooseOption)
 * 3. Gather missing info: amount → mint → proofs
 * 4. Terminal step based on destination
 */
export function resolveNext(
  intent: ResolvedIntent,
  ctx: FlowContext,
  walletCtx: WalletContext
): StepResult {
  // --- Terminal intents ---
  if (intent.type === 'receiveToken') {
    return { step: 'receiveToken', data: { token: intent.option.value } };
  }
  if (intent.type === 'openMint') {
    return { step: 'openMint', data: { url: intent.url } };
  }
  if (intent.type === 'openProfile') {
    return { step: 'openProfile', data: { npub: intent.npub } };
  }
  if (intent.type === 'ignore') {
    return errorResult('UNSUPPORTED_INPUT', intent.reason.message);
  }

  // --- Multi-option ---
  if (intent.type === 'chooseOption') {
    const hasViable = intent.options.some((o) => o.status !== 'disabled');
    if (!hasViable) {
      return errorResult('ALL_OPTIONS_DISABLED', 'All payment options are disabled');
    }
    return {
      step: 'chooseOption',
      data: { parsed: ctx.parsed!, options: intent.options, unit: ctx.unit },
    };
  }

  // --- Gather phase ---
  const destination = getDestination(intent, ctx);
  const supportedMintUrls = ctx.supportedMintUrls;
  const unit = ctx.unit;
  logger.info('resolveNext.routing', {
    intentType: intent.type,
    destination,
    amount: ctx.amount,
    mintUrl: ctx.mintUrl || null,
  });

  // 1. Need amount?
  if (needsAmount(destination, ctx)) {
    logger.info('resolveNext.enterAmount.amountNeeded');

    const preselectedMintUrl = ctx.mintUrl ?? walletCtx.preferredMintUrl;
    return {
      step: 'enterAmount',
      data: {
        unit,
        preselectedMintUrl,
        constraints: {
          destination,
          supportedMintUrls,
          paymentRequest: ctx.paymentRequest,
          meltTarget: ctx.meltTarget,
        },
      },
      contextPatch: { destination },
    };
  }

  // 2. Need mint?
  const amount = ctx.amount!;

  if (
    ctx.mintUrl &&
    isMintValidForFlow(ctx.mintUrl, walletCtx, amount, supportedMintUrls, destination)
  ) {
    // Current mint is valid -- skip to proofs/terminal
  } else if (destination === 'mintQuote') {
    // For receive, prefer mint or let user pick
    const mint = ctx.mintUrl ?? walletCtx.preferredMintUrl;
    if (mint && walletCtx.trustedMintUrls.includes(mint)) {
      return resolveWithMint(mint, destination, amount, unit, ctx, walletCtx);
    }
    if (walletCtx.trustedMintUrls.length === 1) {
      return resolveWithMint(
        walletCtx.trustedMintUrls[0],
        destination,
        amount,
        unit,
        ctx,
        walletCtx
      );
    }
    const candidates = walletCtx.trustedMintUrls.map((mintUrl) => ({
      mintUrl,
      balance: walletCtx.mintBalances[mintUrl] ?? 0,
    }));
    return {
      step: 'selectMint',
      data: { candidates, amount, unit, destination },
      contextPatch: { destination },
    };
  } else {
    // Send/melt: need mint with balance
    const selectionConfig = {
      allowedMints: supportedMintUrls,
      minAmount: amount,
    };
    const selection = needsSpendableBalance(destination)
      ? selectMint(walletCtx, selectionConfig)
      : selectMint(walletCtx, { allowedMints: supportedMintUrls });

    switch (selection.type) {
      case 'selected':
        return resolveWithMint(selection.mintUrl, destination, amount, unit, ctx, walletCtx);
      case 'selectionNeeded':
        return {
          step: 'selectMint',
          data: {
            candidates: selection.validMints,
            supportedMintUrls,
            amount,
            unit,
            paymentRequest: ctx.paymentRequest,
            meltTarget: ctx.meltTarget,
            destination,
          },
          contextPatch: { destination },
        };
      case 'noValidMint':
        return toMintError(selection.reason);
    }
  }

  // 3. Mint is valid. Check proof composition (ecash sends only).
  const mintUrl = ctx.mintUrl!;
  const ctxWithDest = ctx.destination === destination ? ctx : { ...ctx, destination };
  if (needsSpendableBalance(destination)) {
    const proofResult = checkProofComposition(walletCtx, mintUrl, amount, unit, ctxWithDest);
    if (proofResult) return { ...proofResult, contextPatch: { destination } };
  }

  // 4. Terminal step
  return { ...terminalStep(destination, ctx), contextPatch: { destination } };
}

/** Internal helper: set mintUrl in context patch and continue to proofs/terminal. */
function resolveWithMint(
  mintUrl: string,
  destination: Destination,
  amount: number,
  unit: string,
  ctx: FlowContext,
  walletCtx: WalletContext
): StepResult {
  const merged = { ...ctx, mintUrl, destination };

  if (needsSpendableBalance(destination)) {
    const proofResult = checkProofComposition(walletCtx, mintUrl, amount, unit, merged);
    if (proofResult) return { ...proofResult, contextPatch: { mintUrl, destination } };
  }

  return {
    ...terminalStep(destination, merged),
    contextPatch: { mintUrl, destination },
  };
}
