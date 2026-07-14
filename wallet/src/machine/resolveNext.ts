import type { LocalizedReason } from "../formatting/locales";
import { logger } from "../logger";
import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
  hasMintSupportingMethod,
} from "../mint-capabilities";
import { pickPreferredCandidate, selectMint } from "../mint-selection";
import type {
  MintCandidate,
  MintMethodRequirement,
  ResolvedIntent,
  WalletContext,
} from "../types";
import {
  buildChooseAmountFallback,
  buildChooseProofsData,
  buildProofSuggestions,
  findFullAmountCandidates,
} from "./amountFallback";
import type {
  Destination,
  ErrorCode,
  FlowContext,
  FlowStep,
  StepDataMap,
} from "./types";

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

function errorResult(code: ErrorCode, message: string): StepResult<"error"> {
  return { step: "error", data: { code, message } };
}

function summarizeContext(ctx: FlowContext): Record<string, unknown> {
  return {
    amount: ctx.amount ?? null,
    unit: ctx.unit,
    destination: ctx.destination ?? null,
    hasMintUrl: !!ctx.mintUrl,
    mintUrlLength: ctx.mintUrl?.length ?? 0,
    hasPaymentRequest: !!ctx.paymentRequest,
    paymentRequestLength: ctx.paymentRequest?.length ?? 0,
    hasMeltTarget: !!ctx.meltTarget,
    meltTargetLength: ctx.meltTarget?.length ?? 0,
    hasRecipientPubkey: !!ctx.recipientPubkey,
    recipientPubkeyLength: ctx.recipientPubkey?.length ?? 0,
    hasRecipientProfile: !!ctx.recipientProfile,
    hasP2pkLockPubkey: !!ctx.p2pkLockPubkey,
    p2pkLockPubkeyLength: ctx.p2pkLockPubkey?.length ?? 0,
    localProofSend: !!ctx.localProofSend,
    sendMemoHandled: !!ctx.sendMemoHandled,
    mintUnreachableConfirmed: !!ctx.mintUnreachableConfirmed,
    offline: !!ctx.offline,
    supportedMintCount: ctx.supportedMintUrls?.length ?? 0,
    failedOptionCount: ctx.failedOptionValues?.length ?? 0,
    hasReviewToken: !!ctx.reviewToken,
    reviewTokenLength: ctx.reviewToken?.length ?? 0,
    hasRawInput: !!ctx.rawInput,
    rawInputLength: ctx.rawInput?.length ?? 0,
    hasSource: !!ctx.source,
    sourceLength: ctx.source?.length ?? 0,
    originalOptionCount: ctx.originalOptions?.length ?? 0,
  };
}

function summarizeWallet(walletCtx: WalletContext): Record<string, unknown> {
  const balances = Object.values(walletCtx.mintBalances);
  const proofEntries = Object.values(walletCtx.proofAmounts);
  return {
    trustedMintCount: walletCtx.trustedMintUrls.length,
    hasPreferredMint: !!walletCtx.preferredMintUrl,
    preferredMintUrlLength: walletCtx.preferredMintUrl?.length ?? 0,
    balanceMintCount: Object.keys(walletCtx.mintBalances).length,
    totalBalance: balances.reduce((total, balance) => total + balance, 0),
    proofMintCount: Object.keys(walletCtx.proofAmounts).length,
    proofCount: proofEntries.reduce(
      (total, proofs) => total + proofs.length,
      0,
    ),
    proofTotal: proofEntries.reduce(
      (total, proofs) => total + proofs.reduce((sum, proof) => sum + proof, 0),
      0,
    ),
    hasMintMethodCapabilities: !!walletCtx.mintMethodCapabilities,
  };
}

function summarizeCandidates(
  candidates: MintCandidate[],
): Record<string, unknown> {
  return {
    candidateCount: candidates.length,
    enabledCandidateCount: candidates.filter(
      (candidate) => candidate.status !== "disabled",
    ).length,
    disabledCandidateCount: candidates.filter(
      (candidate) => candidate.status === "disabled",
    ).length,
    reasonCodes: candidates
      .map((candidate) => candidate.reason?.code)
      .filter((code): code is string => !!code),
  };
}

function countProofSuggestions(
  suggestions: StepDataMap["chooseProofs"]["suggestions"],
): number {
  if (!suggestions) return 0;
  return (suggestions.roundDown ? 1 : 0) + (suggestions.roundUp ? 1 : 0);
}

function logStepResult<S extends FlowStep>(
  event: string,
  result: StepResult<S>,
  fields: Record<string, unknown> = {},
): StepResult<S> {
  const errorData =
    result.step === "error" ? (result.data as StepDataMap["error"]) : null;
  logger.info(event, {
    step: result.step,
    hasContextPatch: !!result.contextPatch,
    contextPatchKeys: result.contextPatch
      ? Object.keys(result.contextPatch)
      : [],
    errorCode: errorData?.code ?? null,
    errorMessageLength: errorData?.message.length ?? 0,
    ...fields,
  });
  return result;
}

export function toMintError(reason: LocalizedReason): StepResult<"error"> {
  switch (reason.code) {
    case "INSUFFICIENT_BALANCE":
    case "INSUFFICIENT_BALANCE_ALLOWED":
      return errorResult("INSUFFICIENT_BALANCE", reason.message);
    case "NO_BALANCE":
    case "NO_MINT_SUFFICIENT_BALANCE":
      return errorResult("NO_BALANCE", reason.message);
    default:
      return errorResult("NO_VALID_MINT", reason.message);
  }
}

function getDestination(intent: ResolvedIntent, ctx: FlowContext): Destination {
  if (ctx.destination) return ctx.destination;
  switch (intent.type) {
    case "sendPaymentRequest":
      return "paymentRequest";
    case "meltLightningInvoice":
    case "meltBolt12Offer":
    case "meltLightningAddress":
    case "meltLnurlp":
    case "meltOnchainAddress":
      return "meltQuote";
    default:
      return "sendEcash";
  }
}

function needsAmount(ctx: FlowContext): boolean {
  return ctx.amount == null || ctx.amount <= 0;
}

/**
 * For mintQuote (receive), any trusted mint works -- no balance needed.
 * For send/melt, we need a mint with sufficient balance.
 */
function needsSpendableBalance(destination: Destination): boolean {
  return destination !== "mintQuote";
}

function methodRequirementForDestination(
  destination: Destination,
  ctx: FlowContext,
  unit: string,
): MintMethodRequirement | null {
  if (destination === "mintQuote") {
    return { operation: "mint", method: ctx.mintQuoteMethod ?? "bolt11", unit };
  }
  if (destination === "meltQuote") {
    return { operation: "melt", method: ctx.meltQuoteMethod ?? "bolt11", unit };
  }
  return null;
}

function firstMethodError(
  candidates: MintCandidate[],
  fallbackMessage: string,
): StepResult<"error"> {
  const reason = candidates.find((candidate) => candidate.reason)?.reason;
  return errorResult("NO_VALID_MINT", reason?.message ?? fallbackMessage);
}

function buildMethodCandidates(
  walletCtx: WalletContext,
  requirement: MintMethodRequirement,
  amount: number | undefined,
  allowedMints: string[] | undefined,
  destination: Destination,
): MintCandidate[] {
  return buildMethodAwareMintCandidates(walletCtx, requirement, {
    amount,
    allowedMints,
    requireBalance: needsSpendableBalance(destination),
  });
}

function hasOnlyBalanceFailures(candidates: MintCandidate[]): boolean {
  return (
    candidates.length > 0 &&
    candidates.every((candidate) => {
      const code = candidate.reason?.code;
      return code === "INSUFFICIENT_BALANCE" || code === "NO_BALANCE";
    })
  );
}

function isMintValidForFlow(
  mintUrl: string,
  walletCtx: WalletContext,
  amount: number | undefined,
  supportedMintUrls: string[] | undefined,
  destination: Destination,
  ctx: FlowContext,
): boolean {
  if (!walletCtx.trustedMintUrls.includes(mintUrl)) return false;
  if (supportedMintUrls?.length && !supportedMintUrls.includes(mintUrl))
    return false;
  const requirement = methodRequirementForDestination(
    destination,
    ctx,
    ctx.unit,
  );
  if (requirement) {
    const capability = getMintMethodCapability(walletCtx, mintUrl, requirement);
    if (getCapabilityUnavailableReason(capability, requirement, amount) != null)
      return false;
  }
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
  ctx: FlowContext,
): StepResult<"chooseProofs"> | null {
  // Only show proof selector for ecash sends. Lightning melts and payment
  // requests must always attempt the exact amount — the mint handles the
  // swap server-side, so showing a proof picker is incorrect.
  if (ctx.destination !== "sendEcash") {
    logger.info("resolveNext.proofComposition.skipped", {
      reason: "not-ecash-send",
      destination: ctx.destination ?? null,
      amount,
      unit,
      hasMintUrl: !!mintUrl,
      mintUrlLength: mintUrl.length,
    });
    return null;
  }

  // Locked sends never use local proofs — a P2PK lock requires a mint swap.
  if (ctx.p2pkLockPubkey) {
    logger.info("resolveNext.proofComposition.skipped", {
      reason: "p2pk-lock-requires-mint-swap",
      amount,
      unit,
      hasMintUrl: !!mintUrl,
      mintUrlLength: mintUrl.length,
      p2pkLockPubkeyLength: ctx.p2pkLockPubkey.length,
    });
    return null;
  }

  const proofAmounts = walletCtx.proofAmounts[mintUrl] ?? [];
  const proofTotal = proofAmounts.reduce((total, proof) => total + proof, 0);
  if (proofAmounts.length === 0) {
    logger.info("resolveNext.proofComposition.skipped", {
      reason: "no-proofs-for-mint",
      amount,
      unit,
      hasMintUrl: !!mintUrl,
      mintUrlLength: mintUrl.length,
    });
    return null;
  }

  // Online: always skip the proof selector — the mint handles swaps
  // server-side via executeSend. If executeSend fails, the catch block
  // in createMachine falls back to chooseProofs.
  if (!ctx.offline) {
    logger.info("resolveNext.proofComposition.skipped", {
      reason: "online-send-prefers-mint-swap",
      amount,
      unit,
      hasMintUrl: !!mintUrl,
      mintUrlLength: mintUrl.length,
      proofCount: proofAmounts.length,
      proofTotal,
    });
    return null;
  }

  const built = buildProofSuggestions(proofAmounts, amount);
  if (built.exactMatch || !built.hasSuggestion) {
    logger.info("resolveNext.proofComposition.skipped", {
      reason: built.exactMatch
        ? "exact-local-composition"
        : "no-nearby-suggestion",
      amount,
      unit,
      hasMintUrl: !!mintUrl,
      mintUrlLength: mintUrl.length,
      proofCount: proofAmounts.length,
      proofTotal,
      exactMatch: built.exactMatch,
      hasSuggestion: built.hasSuggestion,
      suggestionCount: countProofSuggestions(built.suggestions),
    });
    return null;
  }

  return logStepResult(
    "resolveNext.proofComposition.chooseProofs",
    {
      step: "chooseProofs",
      data: buildChooseProofsData({
        mintUrl,
        amount,
        unit,
        proofAmounts,
        suggestions: built.suggestions,
        ctx,
      }),
    },
    {
      amount,
      unit,
      hasMintUrl: !!mintUrl,
      mintUrlLength: mintUrl.length,
      proofCount: proofAmounts.length,
      proofTotal,
      suggestionCount: countProofSuggestions(built.suggestions),
    },
  );
}

// ---------------------------------------------------------------------------
// Terminal step builders
// ---------------------------------------------------------------------------

function terminalStep(
  destination: Destination,
  ctx: FlowContext,
  enableEcashSendMemo: boolean,
): StepResult {
  logger.info("resolveNext.terminal", {
    destination,
    amount: ctx.amount,
    unit: ctx.unit,
    hasMintUrl: !!ctx.mintUrl,
    mintUrlLength: ctx.mintUrl?.length ?? 0,
    enableEcashSendMemo,
    sendMemoHandled: !!ctx.sendMemoHandled,
    hasMemo: !!ctx.memo,
    memoLength: ctx.memo?.length ?? 0,
  });
  const {
    mintUrl,
    amount,
    unit,
    meltTarget,
    recipientPubkey,
    recipientProfile,
  } = ctx;

  switch (destination) {
    case "mintQuote":
      return {
        step: "createMintQuote",
        data: {
          mintUrl: mintUrl!,
          amount: amount!,
          unit,
          method: ctx.mintQuoteMethod,
        },
      };
    case "receivePaymentRequest":
      return {
        step: "createPaymentRequestReceive",
        data: { amount: amount!, unit },
      };
    case "meltQuote":
      return {
        step: "navigateToMeltPreview",
        data: {
          mintUrl: mintUrl!,
          meltTarget: meltTarget!,
          unit,
          amount: amount!,
          recipientPubkey,
          recipientProfile,
        },
      };
    case "paymentRequest":
      return {
        step: "navigateToPaymentRequest",
        data: {
          mintUrl: mintUrl!,
          paymentRequest: ctx.paymentRequest!,
          amount: amount!,
          unit,
          recipientPubkey,
          recipientProfile,
        },
      };
    case "sendEcash":
      if (enableEcashSendMemo && !ctx.sendMemoHandled) {
        return {
          step: "enterSendMemo",
          data: {
            mintUrl: mintUrl!,
            amount: amount!,
            unit,
            ...(ctx.memo ? { memo: ctx.memo } : {}),
          },
        };
      }
      return {
        step: "confirmSend",
        data: {
          mintUrl: mintUrl!,
          amount: amount!,
          ...(ctx.memo ? { memo: ctx.memo } : {}),
        },
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
  walletCtx: WalletContext,
  enableEcashSendMemo = false,
): StepResult {
  logger.info("resolveNext.start", {
    intentType: intent.type,
    enableEcashSendMemo,
    ...summarizeContext(ctx),
    ...summarizeWallet(walletCtx),
  });

  // --- Terminal intents ---
  if (intent.type === "receiveToken") {
    return logStepResult(
      "resolveNext.terminalIntent",
      { step: "receiveToken", data: { token: intent.option.value } },
      {
        intentType: intent.type,
        tokenLength: intent.option.value.length,
      },
    );
  }
  if (intent.type === "openMint") {
    return logStepResult(
      "resolveNext.terminalIntent",
      { step: "openMint", data: { url: intent.url } },
      {
        intentType: intent.type,
        urlLength: intent.url.length,
      },
    );
  }
  if (intent.type === "openProfile") {
    return logStepResult(
      "resolveNext.terminalIntent",
      { step: "openProfile", data: { npub: intent.npub } },
      {
        intentType: intent.type,
        npubLength: intent.npub.length,
      },
    );
  }
  if (intent.type === "ignore") {
    return logStepResult(
      "resolveNext.terminalIntent",
      errorResult("UNSUPPORTED_INPUT", intent.reason.message),
      {
        intentType: intent.type,
        reasonCode: intent.reason.code,
      },
    );
  }
  if (intent.type === "meltOnchainAddress") {
    const requirement: MintMethodRequirement = {
      operation: "melt",
      method: "onchain",
      unit: ctx.unit,
    };
    if (!hasMintSupportingMethod(walletCtx, requirement)) {
      return logStepResult(
        "resolveNext.onchainUnsupported",
        errorResult(
          "NO_VALID_MINT",
          "No trusted mint supports onchain sending",
        ),
        {
          reason: "no-trusted-mint-support",
          unit: ctx.unit,
        },
      );
    }
  }
  if (intent.type === "meltBolt12Offer") {
    const requirement: MintMethodRequirement = {
      operation: "melt",
      method: "bolt12",
      unit: ctx.unit,
    };
    if (!hasMintSupportingMethod(walletCtx, requirement)) {
      return logStepResult(
        "resolveNext.bolt12Unsupported",
        errorResult(
          "NO_VALID_MINT",
          "No trusted mint supports BOLT 12 sending",
        ),
        {
          reason: "no-trusted-mint-support",
          unit: ctx.unit,
        },
      );
    }
  }

  // --- Multi-option ---
  if (intent.type === "chooseOption") {
    const hasViable = intent.options.some((o) => o.status !== "disabled");
    if (!hasViable) {
      return logStepResult(
        "resolveNext.chooseOption",
        errorResult("ALL_OPTIONS_DISABLED", "All payment options are disabled"),
        {
          optionCount: intent.options.length,
          viableOptionCount: 0,
        },
      );
    }
    return logStepResult(
      "resolveNext.chooseOption",
      {
        step: "chooseOption",
        data: { parsed: ctx.parsed!, options: intent.options, unit: ctx.unit },
      },
      {
        optionCount: intent.options.length,
        viableOptionCount: intent.options.filter(
          (option) => option.status !== "disabled",
        ).length,
      },
    );
  }

  // --- Gather phase ---
  const destination = getDestination(intent, ctx);
  const supportedMintUrls = ctx.supportedMintUrls;
  const unit = ctx.unit;
  logger.info("resolveNext.routing", {
    intentType: intent.type,
    destination,
    amount: ctx.amount,
    hasMintUrl: !!ctx.mintUrl,
    mintUrlLength: ctx.mintUrl?.length ?? 0,
    supportedMintCount: supportedMintUrls?.length ?? 0,
    unit,
  });

  // 1. Need amount?
  if (needsAmount(ctx)) {
    logger.info("resolveNext.enterAmount.amountNeeded", {
      intentType: intent.type,
      destination,
      unit,
      hasPreselectedMint: !!(ctx.mintUrl ?? walletCtx.preferredMintUrl),
      preselectedMintUrlLength:
        (ctx.mintUrl ?? walletCtx.preferredMintUrl)?.length ?? 0,
      supportedMintCount: supportedMintUrls?.length ?? 0,
      hasPaymentRequest: !!ctx.paymentRequest,
      paymentRequestLength: ctx.paymentRequest?.length ?? 0,
      hasMeltTarget: !!ctx.meltTarget,
      meltTargetLength: ctx.meltTarget?.length ?? 0,
      hasRecipientPubkey: !!ctx.recipientPubkey,
      hasRecipientProfile: !!ctx.recipientProfile,
    });

    const preselectedMintUrl = ctx.mintUrl ?? walletCtx.preferredMintUrl;
    return logStepResult(
      "resolveNext.enterAmount",
      {
        step: "enterAmount",
        data: {
          unit,
          preselectedMintUrl,
          constraints: {
            destination,
            supportedMintUrls,
            paymentRequest: ctx.paymentRequest,
            meltTarget: ctx.meltTarget,
            methodContext: createAmountEntryMethodContext(walletCtx),
            // Carry recipient identity onto the amount-entry constraints so the
            // scan-LA flow (EXECUTE → resolveNext → enterAmount) reaches the
            // amount screen with the same fields the chat-launched flow gets
            // via handleStartSendEcash. Without this, the navigation handler's
            // entry serialization loses pubkey/profile and AmountFlowScreen
            // never shows the recipient header on first paint.
            recipientPubkey: ctx.recipientPubkey,
            recipientProfile: ctx.recipientProfile,
            p2pkLockPubkey: ctx.p2pkLockPubkey,
          },
        },
        contextPatch: { destination },
      },
      {
        destination,
        unit,
        hasPreselectedMint: !!preselectedMintUrl,
        preselectedMintUrlLength: preselectedMintUrl?.length ?? 0,
      },
    );
  }

  // 2. Need mint?
  const amount = ctx.amount!;

  if (
    ctx.mintUrl &&
    isMintValidForFlow(
      ctx.mintUrl,
      walletCtx,
      amount,
      supportedMintUrls,
      destination,
      ctx,
    )
  ) {
    // Current mint is valid -- skip to proofs/terminal
    logger.info("resolveNext.mint.currentValid", {
      destination,
      amount,
      unit,
      mintUrlLength: ctx.mintUrl.length,
    });
  } else if (destination === "mintQuote") {
    const requirement = methodRequirementForDestination(destination, ctx, unit);
    const methodCandidates = requirement
      ? buildMethodCandidates(
          walletCtx,
          requirement,
          amount,
          supportedMintUrls,
          destination,
        )
      : null;
    const availableMethodCandidates =
      methodCandidates?.filter(
        (candidate) => candidate.status !== "disabled",
      ) ?? null;

    // For receive, prefer mint or let user pick
    const mint = ctx.mintUrl ?? walletCtx.preferredMintUrl;
    if (
      mint &&
      isMintValidForFlow(
        mint,
        walletCtx,
        amount,
        supportedMintUrls,
        destination,
        ctx,
      )
    ) {
      logger.info("resolveNext.mint.selected", {
        reason: ctx.mintUrl ? "context-mint-valid" : "preferred-mint-valid",
        destination,
        amount,
        unit,
        mintUrlLength: mint.length,
      });
      return resolveWithMint(
        mint,
        destination,
        amount,
        unit,
        ctx,
        walletCtx,
        enableEcashSendMemo,
      );
    }
    if (!requirement && walletCtx.trustedMintUrls.length === 1) {
      logger.info("resolveNext.mint.selected", {
        reason: "single-trusted-mint",
        destination,
        amount,
        unit,
        mintUrlLength: walletCtx.trustedMintUrls[0].length,
      });
      return resolveWithMint(
        walletCtx.trustedMintUrls[0],
        destination,
        amount,
        unit,
        ctx,
        walletCtx,
        enableEcashSendMemo,
      );
    }
    if (
      requirement &&
      (!availableMethodCandidates || availableMethodCandidates.length === 0)
    ) {
      return logStepResult(
        "resolveNext.mint.methodError",
        firstMethodError(
          methodCandidates ?? [],
          `No trusted mint supports ${requirement.method} receive`,
        ),
        {
          destination,
          amount,
          unit,
          requirementOperation: requirement.operation,
          requirementMethod: requirement.method,
          ...summarizeCandidates(methodCandidates ?? []),
        },
      );
    }
    const candidates = walletCtx.trustedMintUrls.map((mintUrl) => ({
      mintUrl,
      balance: walletCtx.mintBalances[mintUrl] ?? 0,
    }));
    return logStepResult(
      "resolveNext.mint.selectionNeeded",
      {
        step: "selectMint",
        data: {
          candidates: methodCandidates ?? candidates,
          supportedMintUrls,
          amount,
          unit,
          destination,
          mintQuoteMethod: ctx.mintQuoteMethod,
          methodRequirement: requirement ?? undefined,
        },
        contextPatch: { destination },
      },
      {
        destination,
        amount,
        unit,
        candidateCount: (methodCandidates ?? candidates).length,
        supportedMintCount: supportedMintUrls?.length ?? 0,
        hasRequirement: !!requirement,
        requirementMethod: requirement?.method ?? null,
      },
    );
  } else {
    // Send/melt: need mint with balance
    const requirement = methodRequirementForDestination(destination, ctx, unit);
    const methodCandidates = requirement
      ? buildMethodCandidates(
          walletCtx,
          requirement,
          amount,
          supportedMintUrls,
          destination,
        )
      : null;
    const availableMethodCandidates =
      methodCandidates?.filter(
        (candidate) => candidate.status !== "disabled",
      ) ?? null;
    if (
      requirement &&
      availableMethodCandidates &&
      availableMethodCandidates.length === 0 &&
      (requirement.method !== "bolt11" ||
        !hasOnlyBalanceFailures(methodCandidates ?? []))
    ) {
      return logStepResult(
        "resolveNext.mint.methodError",
        firstMethodError(
          methodCandidates ?? [],
          `No trusted mint supports ${requirement.method} ${requirement.operation}`,
        ),
        {
          destination,
          amount,
          unit,
          requirementOperation: requirement.operation,
          requirementMethod: requirement.method,
          ...summarizeCandidates(methodCandidates ?? []),
        },
      );
    }
    const fullAmountCandidates = requirement
      ? (availableMethodCandidates ?? [])
      : needsSpendableBalance(destination)
        ? findFullAmountCandidates(walletCtx, amount, supportedMintUrls)
        : [];
    // When a mint hasn't been chosen yet, auto-pick rather than forcing the
    // selector. For Lightning melts, honor the preferred mint (else highest
    // balance) across ALL eligible mints — the user can still change it via
    // the mint pill on the confirm screen. Ecash sends keep the stricter
    // single-candidate shortcut, since the chosen mint determines which mint's
    // tokens are handed out.
    let autoPick: MintCandidate | undefined;
    if (
      needsSpendableBalance(destination) &&
      !ctx.mintUrl &&
      fullAmountCandidates.length > 0
    ) {
      if (requirement?.method === "bolt11") {
        autoPick = pickPreferredCandidate(
          fullAmountCandidates,
          walletCtx.preferredMintUrl,
        );
        logger.info("resolveNext.mint.meltAutoPick", {
          destination,
          amount,
          unit,
          candidateCount: fullAmountCandidates.length,
          reason:
            autoPick?.mintUrl === walletCtx.preferredMintUrl
              ? "preferred"
              : "highest_balance",
          mintUrlLength: autoPick?.mintUrl.length ?? 0,
        });
      } else if (fullAmountCandidates.length === 1) {
        autoPick = fullAmountCandidates[0];
      }
    }
    const selection = !needsSpendableBalance(destination)
      ? selectMint(walletCtx, { allowedMints: supportedMintUrls })
      : autoPick
        ? {
            type: "selected" as const,
            mintUrl: autoPick.mintUrl,
            balance: autoPick.balance,
          }
        : fullAmountCandidates.length > 0
          ? {
              type: "selectionNeeded" as const,
              validMints: fullAmountCandidates,
            }
          : selectMint(walletCtx, {
              allowedMints: supportedMintUrls,
              minAmount: amount,
            });

    switch (selection.type) {
      case "selected":
        logger.info("resolveNext.mint.selected", {
          reason: "selection-selected",
          destination,
          amount,
          unit,
          mintUrlLength: selection.mintUrl.length,
          balance: selection.balance,
        });
        return resolveWithMint(
          selection.mintUrl,
          destination,
          amount,
          unit,
          ctx,
          walletCtx,
          enableEcashSendMemo,
        );
      case "selectionNeeded":
        return logStepResult(
          "resolveNext.mint.selectionNeeded",
          {
            step: "selectMint",
            data: {
              candidates: selection.validMints,
              supportedMintUrls,
              amount,
              unit,
              paymentRequest: ctx.paymentRequest,
              meltTarget: ctx.meltTarget,
              recipientPubkey: ctx.recipientPubkey,
              recipientProfile: ctx.recipientProfile,
              destination,
              mintQuoteMethod: ctx.mintQuoteMethod,
              meltQuoteMethod: ctx.meltQuoteMethod,
              methodRequirement: requirement ?? undefined,
            },
            contextPatch: { destination },
          },
          {
            destination,
            amount,
            unit,
            candidateCount: selection.validMints.length,
            supportedMintCount: supportedMintUrls?.length ?? 0,
            hasPaymentRequest: !!ctx.paymentRequest,
            paymentRequestLength: ctx.paymentRequest?.length ?? 0,
            hasMeltTarget: !!ctx.meltTarget,
            meltTargetLength: ctx.meltTarget?.length ?? 0,
            hasRequirement: !!requirement,
            requirementMethod: requirement?.method ?? null,
          },
        );
      case "noValidMint":
        if (needsSpendableBalance(destination)) {
          const fallback = buildChooseAmountFallback({
            walletCtx,
            ctx: { ...ctx, destination },
            destination,
            amount,
            preferredMintUrl: walletCtx.preferredMintUrl,
          });
          if (fallback) {
            return logStepResult(
              "resolveNext.mint.noValidMintProofFallback",
              {
                step: "chooseProofs",
                data: buildChooseProofsData({
                  mintUrl: fallback.mintUrl,
                  amount,
                  unit,
                  proofAmounts: fallback.proofAmounts,
                  suggestions: fallback.suggestions,
                  ctx: { ...ctx, destination, mintUrl: fallback.mintUrl },
                }),
                contextPatch: { destination, mintUrl: fallback.mintUrl },
              },
              {
                destination,
                amount,
                unit,
                fallbackMintUrlLength: fallback.mintUrl.length,
                proofCount: fallback.proofAmounts.length,
                proofTotal: fallback.proofAmounts.reduce(
                  (total, proof) => total + proof,
                  0,
                ),
                suggestionCount: countProofSuggestions(fallback.suggestions),
              },
            );
          }
        }
        return logStepResult(
          "resolveNext.mint.noValidMint",
          toMintError(selection.reason),
          {
            destination,
            amount,
            unit,
            reasonCode: selection.reason.code,
          },
        );
    }
  }

  // 3. Mint is valid. Check proof composition (ecash sends only).
  const mintUrl = ctx.mintUrl!;
  const ctxWithDest =
    ctx.destination === destination ? ctx : { ...ctx, destination };
  if (needsSpendableBalance(destination)) {
    const proofResult = checkProofComposition(
      walletCtx,
      mintUrl,
      amount,
      unit,
      ctxWithDest,
    );
    if (proofResult) {
      return logStepResult(
        "resolveNext.proofComposition.result",
        { ...proofResult, contextPatch: { destination } },
        {
          destination,
          amount,
          unit,
          mintUrlLength: mintUrl.length,
        },
      );
    }
  }

  // 4. Terminal step
  return logStepResult(
    "resolveNext.terminal.result",
    {
      ...terminalStep(destination, ctx, enableEcashSendMemo),
      contextPatch: { destination },
    },
    {
      destination,
      amount,
      unit,
      hasMintUrl: !!ctx.mintUrl,
      mintUrlLength: ctx.mintUrl?.length ?? 0,
    },
  );
}

/** Internal helper: set mintUrl in context patch and continue to proofs/terminal. */
function resolveWithMint(
  mintUrl: string,
  destination: Destination,
  amount: number,
  unit: string,
  ctx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo: boolean,
): StepResult {
  const merged = { ...ctx, mintUrl, destination };

  if (needsSpendableBalance(destination)) {
    const proofResult = checkProofComposition(
      walletCtx,
      mintUrl,
      amount,
      unit,
      merged,
    );
    if (proofResult) {
      return logStepResult(
        "resolveNext.resolveWithMint.proofComposition",
        { ...proofResult, contextPatch: { mintUrl, destination } },
        {
          destination,
          amount,
          unit,
          mintUrlLength: mintUrl.length,
        },
      );
    }
  }

  return logStepResult(
    "resolveNext.resolveWithMint.terminal",
    {
      ...terminalStep(destination, merged, enableEcashSendMemo),
      contextPatch: { mintUrl, destination },
    },
    {
      destination,
      amount,
      unit,
      mintUrlLength: mintUrl.length,
    },
  );
}
