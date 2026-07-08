import {
  buildMethodAwareMintCandidates,
  createAmountEntryMethodContext,
  getCapabilityUnavailableReason,
  getMintMethodCapability,
} from "../mint-capabilities";
import { localizeReason } from "../formatting/locales";
import { logger, mintUrlFields } from "../logger";
import {
  getValidMintCandidates,
  pickPreferredCandidate,
  selectMint,
} from "../mint-selection";
import type {
  MintCandidate,
  MintMethodRequirement,
  WalletContext,
} from "../types";
import {
  buildChooseAmountFallback,
  buildChooseProofsData,
  buildProofSuggestions,
  findFullAmountCandidates,
} from "./amountFallback";
import { toMintError } from "./resolveNext";
import type {
  Destination,
  FlowContext,
  FlowEvent,
  FlowStep,
  StepDataMap,
} from "./types";

export interface ContextResolutionResult<S extends FlowStep = FlowStep> {
  step: S;
  context: FlowContext;
  data: StepDataMap[S];
}

function summarizeContext(ctx: FlowContext): Record<string, unknown> {
  return {
    destination: ctx.destination,
    ...mintUrlFields(ctx.mintUrl),
    unit: ctx.unit,
    amount: ctx.amount,
    offline: !!ctx.offline,
    source: ctx.source,
    supportedMintCount: ctx.supportedMintUrls?.length ?? 0,
    hasPaymentRequest: !!ctx.paymentRequest,
    paymentRequestLength: ctx.paymentRequest?.length,
    hasMeltTarget: !!ctx.meltTarget,
    meltTargetLength: ctx.meltTarget?.length,
    hasP2pkLock: !!ctx.p2pkLockPubkey,
    hasMemo: !!ctx.memo,
    sendMemoHandled: !!ctx.sendMemoHandled,
    hasRecipientPubkey: !!ctx.recipientPubkey,
    hasRecipientProfile: !!ctx.recipientProfile,
    mintQuoteMethod: ctx.mintQuoteMethod,
    meltQuoteMethod: ctx.meltQuoteMethod,
  };
}

function summarizeCandidates(
  candidates: MintCandidate[],
): Record<string, unknown>[] {
  return candidates.map((candidate) => ({
    ...mintUrlFields(candidate.mintUrl),
    balance: candidate.balance,
    status: candidate.status,
    reasonCode: candidate.reason?.code,
  }));
}

function summarizeResultData(
  result: ContextResolutionResult,
): Record<string, unknown> {
  const data = result.data as Record<string, unknown>;
  const suggestions = data.suggestions as
    | { roundDown?: unknown; roundUp?: unknown }
    | undefined;
  const methodRequirement = data.methodRequirement as
    | MintMethodRequirement
    | undefined;
  const candidates = Array.isArray(data.candidates)
    ? (data.candidates as MintCandidate[])
    : [];
  return {
    dataHasMintUrl: typeof data.mintUrl === "string",
    dataMintUrlLength:
      typeof data.mintUrl === "string" ? data.mintUrl.length : undefined,
    dataAmount: typeof data.amount === "number" ? data.amount : undefined,
    dataUnit: typeof data.unit === "string" ? data.unit : undefined,
    candidateCount: candidates.length || undefined,
    candidates: candidates.length ? summarizeCandidates(candidates) : undefined,
    errorCode: typeof data.code === "string" ? data.code : undefined,
    hasPaymentRequest: typeof data.paymentRequest === "string",
    paymentRequestLength:
      typeof data.paymentRequest === "string"
        ? data.paymentRequest.length
        : undefined,
    hasMeltTarget: typeof data.meltTarget === "string",
    meltTargetLength:
      typeof data.meltTarget === "string" ? data.meltTarget.length : undefined,
    proofCount: Array.isArray(data.proofAmounts)
      ? data.proofAmounts.length
      : undefined,
    hasRoundDown: !!suggestions?.roundDown,
    hasRoundUp: !!suggestions?.roundUp,
    scope: data.scope,
    methodRequirement: methodRequirement
      ? {
          operation: methodRequirement.operation,
          method: methodRequirement.method,
          unit: methodRequirement.unit,
        }
      : undefined,
  };
}

function logContextResult<S extends FlowStep>(
  reason: string,
  result: ContextResolutionResult<S>,
): ContextResolutionResult<S> {
  logger.info("contextResolution.result", {
    reason,
    step: result.step,
    ...summarizeContext(result.context),
    ...summarizeResultData(result),
  });
  return result;
}

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

function buildMethodCandidates(
  walletCtx: WalletContext,
  requirement: MintMethodRequirement,
  amount: number | undefined,
  allowedMints: string[] | undefined,
  destination: Destination,
): MintCandidate[] {
  const candidates = buildMethodAwareMintCandidates(walletCtx, requirement, {
    amount,
    allowedMints,
    requireBalance: needsSpendableBalance(destination),
  });
  logger.debug("contextResolution.methodCandidates", {
    destination,
    amount,
    allowedMintCount: allowedMints?.length ?? 0,
    operation: requirement.operation,
    method: requirement.method,
    unit: requirement.unit,
    candidateCount: candidates.length,
    availableCount: candidates.filter(
      (candidate) => candidate.status !== "disabled",
    ).length,
  });
  return candidates;
}

function hideMethodUnsupportedCandidates(
  candidates: MintCandidate[],
): MintCandidate[] {
  const filtered = candidates.filter((candidate) => {
    const code = candidate.reason?.code;
    return (
      code !== "MINT_METHOD_DISABLED" && code !== "MINT_METHOD_UNSUPPORTED"
    );
  });
  logger.debug("contextResolution.hideUnsupportedCandidates", {
    before: candidates.length,
    after: filtered.length,
  });
  return filtered;
}

function hasOnlyBalanceFailures(candidates: MintCandidate[]): boolean {
  const result =
    candidates.length > 0 &&
    candidates.every((candidate) => {
      const code = candidate.reason?.code;
      return code === "INSUFFICIENT_BALANCE" || code === "NO_BALANCE";
    });
  logger.debug("contextResolution.onlyBalanceFailures", {
    candidateCount: candidates.length,
    result,
  });
  return result;
}

function isMintValidForFlow(
  mintUrl: string,
  walletCtx: WalletContext,
  amount: number | undefined,
  supportedMintUrls: string[] | undefined,
  destination: Destination,
  ctx: FlowContext,
): boolean {
  if (!walletCtx.trustedMintUrls.includes(mintUrl)) {
    logger.debug("contextResolution.mintInvalid", {
      reason: "not_trusted",
      ...mintUrlFields(mintUrl),
      destination,
      amount,
    });
    return false;
  }
  if (supportedMintUrls?.length && !supportedMintUrls.includes(mintUrl)) {
    logger.debug("contextResolution.mintInvalid", {
      reason: "not_supported_by_request",
      ...mintUrlFields(mintUrl),
      destination,
      amount,
      supportedMintCount: supportedMintUrls.length,
    });
    return false;
  }
  const requirement = methodRequirementForDestination(
    destination,
    ctx,
    ctx.unit,
  );
  if (requirement) {
    const capability = getMintMethodCapability(walletCtx, mintUrl, requirement);
    const unavailableReason = getCapabilityUnavailableReason(
      capability,
      requirement,
      amount,
    );
    if (unavailableReason != null) {
      logger.debug("contextResolution.mintInvalid", {
        reason: "method_unavailable",
        reasonCode: unavailableReason.code,
        ...mintUrlFields(mintUrl),
        destination,
        amount,
        operation: requirement.operation,
        method: requirement.method,
        unit: requirement.unit,
      });
      return false;
    }
  }
  if (!needsSpendableBalance(destination)) {
    logger.debug("contextResolution.mintValid", {
      ...mintUrlFields(mintUrl),
      destination,
      amount,
      reason: "no_spendable_balance_needed",
    });
    return true;
  }
  const balance = walletCtx.mintBalances[mintUrl] ?? 0;
  if (amount != null && amount > 0) {
    const result = balance >= amount;
    logger.debug(
      result ? "contextResolution.mintValid" : "contextResolution.mintInvalid",
      {
        reason: result ? "sufficient_balance" : "insufficient_balance",
        ...mintUrlFields(mintUrl),
        destination,
        amount,
        balance,
      },
    );
    return result;
  }
  const result = balance > 0;
  logger.debug(
    result ? "contextResolution.mintValid" : "contextResolution.mintInvalid",
    {
      reason: result ? "positive_balance" : "no_balance",
      ...mintUrlFields(mintUrl),
      destination,
      balance,
    },
  );
  return result;
}

function buildSelectMintRedirect(
  ctx: FlowContext,
  destination: Destination,
  candidates: MintCandidate[],
  amount: number | undefined,
): ContextResolutionResult<"selectMint"> {
  const requirement = methodRequirementForDestination(
    destination,
    ctx,
    ctx.unit,
  );
  const finalCandidates =
    destination === "mintQuote" && requirement
      ? hideMethodUnsupportedCandidates(candidates)
      : candidates;

  const result: ContextResolutionResult<"selectMint"> = {
    step: "selectMint",
    context: { ...ctx, destination },
    data: {
      candidates: finalCandidates,
      supportedMintUrls: ctx.supportedMintUrls,
      amount,
      unit: ctx.unit,
      paymentRequest: ctx.paymentRequest,
      meltTarget: ctx.meltTarget,
      recipientPubkey: ctx.recipientPubkey,
      recipientProfile: ctx.recipientProfile,
      destination,
      mintQuoteMethod: ctx.mintQuoteMethod,
      meltQuoteMethod: ctx.meltQuoteMethod,
      methodRequirement: requirement ?? undefined,
    },
  };
  logger.info("contextResolution.selectMintRedirect", {
    destination,
    amount,
    inputCandidateCount: candidates.length,
    finalCandidateCount: finalCandidates.length,
    method: requirement?.method,
    operation: requirement?.operation,
    candidates: summarizeCandidates(finalCandidates),
  });
  return result;
}

type RevalidateResult =
  | { kind: "ok"; mintUrl: string }
  | { kind: "redirect"; result: ContextResolutionResult };

function revalidateMintForAmount(
  ctx: FlowContext,
  walletCtx: WalletContext,
  destination: Destination,
  amount: number,
): RevalidateResult {
  const currentMint = ctx.mintUrl;
  const requirement = methodRequirementForDestination(
    destination,
    ctx,
    ctx.unit,
  );
  logger.debug("contextResolution.revalidate.start", {
    destination,
    amount,
    hasCurrentMint: !!currentMint,
    currentMintUrlLength: currentMint?.length ?? 0,
    supportedMintCount: ctx.supportedMintUrls?.length ?? 0,
    method: requirement?.method,
    operation: requirement?.operation,
  });
  if (
    currentMint &&
    isMintValidForFlow(
      currentMint,
      walletCtx,
      amount,
      ctx.supportedMintUrls,
      destination,
      ctx,
    )
  ) {
    logger.info("contextResolution.revalidate.ok", {
      reason: "current_mint_valid",
      destination,
      amount,
      ...mintUrlFields(currentMint),
    });
    return { kind: "ok", mintUrl: currentMint };
  }

  if (requirement) {
    const methodCandidates = buildMethodCandidates(
      walletCtx,
      requirement,
      amount,
      ctx.supportedMintUrls,
      destination,
    );
    const availableCandidates = methodCandidates.filter(
      (candidate) => candidate.status !== "disabled",
    );
    if (availableCandidates.length > 0) {
      // Lightning melts auto-pick the preferred mint (else highest balance)
      // across all eligible mints instead of forcing the selector; the user
      // can still change it via the mint pill on the confirm screen.
      if (requirement.method === "bolt11" && !currentMint) {
        const picked = pickPreferredCandidate(
          availableCandidates,
          walletCtx.preferredMintUrl,
        );
        if (picked) {
          logger.info("contextResolution.revalidate.ok", {
            reason:
              picked.mintUrl === walletCtx.preferredMintUrl
                ? "preferred_melt_candidate"
                : "highest_balance_melt_candidate",
            destination,
            amount,
            ...mintUrlFields(picked.mintUrl),
            method: requirement.method,
            candidateCount: availableCandidates.length,
          });
          return { kind: "ok", mintUrl: picked.mintUrl };
        }
      }
      logger.info("contextResolution.revalidate.redirect", {
        reason: "method_candidates_need_selection",
        destination,
        amount,
        candidateCount: methodCandidates.length,
        availableCount: availableCandidates.length,
        method: requirement.method,
      });
      return {
        kind: "redirect",
        result: buildSelectMintRedirect(
          ctx,
          destination,
          methodCandidates,
          amount,
        ),
      };
    }

    if (
      requirement.method === "bolt11" &&
      hasOnlyBalanceFailures(methodCandidates)
    ) {
      // If the method is supported but the amount is too high, offer nearby
      // proof amounts instead of reporting method incompatibility.
    } else {
      const reason = methodCandidates.find(
        (candidate) => candidate.reason,
      )?.reason;
      logger.warn("contextResolution.revalidate.redirect", {
        reason: "no_method_candidate",
        reasonCode: reason?.code,
        destination,
        amount,
        candidateCount: methodCandidates.length,
        method: requirement.method,
      });
      return {
        kind: "redirect",
        result: {
          step: "error",
          context: { ...ctx, destination },
          data: {
            code: "NO_VALID_MINT",
            message:
              reason?.message ??
              `No trusted mint supports ${requirement.method}`,
          },
        },
      };
    }
  }

  const selection = selectMint(walletCtx, {
    allowedMints: ctx.supportedMintUrls,
    minAmount: amount,
  });
  const fullAmountCandidates = findFullAmountCandidates(
    walletCtx,
    amount,
    ctx.supportedMintUrls,
  );
  switch (selection.type) {
    case "selected":
      if (currentMint && selection.mintUrl !== currentMint) {
        logger.info("contextResolution.revalidate.redirect", {
          reason: "selected_mint_changed",
          destination,
          amount,
          hasCurrentMint: !!currentMint,
          currentMintUrlLength: currentMint?.length ?? 0,
          hasSelectedMint: !!selection.mintUrl,
          selectedMintUrlLength: selection.mintUrl.length,
          fullAmountCandidateCount: fullAmountCandidates.length,
        });
        return {
          kind: "redirect",
          result: buildSelectMintRedirect(
            ctx,
            destination,
            fullAmountCandidates.length > 0
              ? fullAmountCandidates
              : [{ mintUrl: selection.mintUrl, balance: selection.balance }],
            amount,
          ),
        };
      }
      logger.info("contextResolution.revalidate.ok", {
        reason: "selected_mint",
        destination,
        amount,
        ...mintUrlFields(selection.mintUrl),
      });
      return { kind: "ok", mintUrl: selection.mintUrl };
    case "selectionNeeded":
      logger.info("contextResolution.revalidate.redirect", {
        reason: "selection_needed",
        destination,
        amount,
        candidateCount: selection.validMints.length,
      });
      return {
        kind: "redirect",
        result: buildSelectMintRedirect(
          ctx,
          destination,
          selection.validMints,
          amount,
        ),
      };
    case "noValidMint": {
      const fallback = buildChooseAmountFallback({
        walletCtx,
        ctx: { ...ctx, destination },
        destination,
        amount,
        preferredMintUrl: walletCtx.preferredMintUrl,
      });
      if (fallback) {
        logger.info("contextResolution.revalidate.redirect", {
          reason: "choose_amount_fallback",
          destination,
          amount,
          ...mintUrlFields(fallback.mintUrl),
          proofCount: fallback.proofAmounts.length,
        });
        return {
          kind: "redirect",
          result: {
            step: "chooseProofs",
            context: { ...ctx, mintUrl: fallback.mintUrl, destination },
            data: buildChooseProofsData({
              mintUrl: fallback.mintUrl,
              amount,
              unit: ctx.unit,
              proofAmounts: fallback.proofAmounts,
              suggestions: fallback.suggestions,
              ctx: { ...ctx, mintUrl: fallback.mintUrl, destination },
            }),
          },
        };
      }
      const err = toMintError(selection.reason);
      logger.warn("contextResolution.revalidate.redirect", {
        reason: "no_valid_mint",
        reasonCode: selection.reason.code,
        destination,
        amount,
      });
      return {
        kind: "redirect",
        result: {
          step: "error",
          context: { ...ctx, destination },
          data: err.data,
        },
      };
    }
  }
}

export function requestMintSelector(
  event: FlowEvent & { type: "REQUEST_MINT_SELECTOR" },
  currentCtx: FlowContext,
  walletCtx: WalletContext,
): ContextResolutionResult<"selectMint"> {
  // A persist-only selection (NPC mint, or a receive-rail's "Receiving with"
  // mint) only chooses which mint backs that address/offer. It must never
  // inherit a stale receive/send `destination` (e.g. a `mintQuote` left over
  // from a Fixed Amount lightning flow the user backed out of) — otherwise
  // picking a mint would resolve that destination and reopen the amount
  // selector. Opening the picker with a clean context also shows the full
  // trusted-mint list instead of one filtered by the stale destination's
  // method requirement.
  const methodScope =
    event.scope === "bolt12" || event.scope === "onchain" ? event.scope : null;
  const persistOnly = event.scope === "npc" || methodScope !== null;
  const ctx =
    currentCtx.destination && !persistOnly
      ? currentCtx
      : ({ unit: currentCtx.unit } as FlowContext);
  logger.debug("contextResolution.requestMintSelector.start", {
    scope: event.scope,
    ...summarizeContext(ctx),
  });

  const amount = ctx.amount;
  // Receive-rail scopes carry their method requirement directly (the rail IS
  // the method); destination flows derive it from the destination.
  const requirement = methodScope
    ? {
        operation: "mint" as const,
        method: methodScope,
        unit: ctx.unit,
      }
    : ctx.destination
      ? methodRequirementForDestination(ctx.destination, ctx, ctx.unit)
      : null;
  const methodCandidates =
    requirement && !methodScope
      ? buildMethodCandidates(
          walletCtx,
          requirement,
          amount,
          ctx.supportedMintUrls,
          ctx.destination!,
        )
      : null;
  const candidates = getValidMintCandidates(walletCtx, { minAmount: amount });

  const allTrustedCandidates = walletCtx.trustedMintUrls.map((mintUrl) => ({
    mintUrl,
    balance: walletCtx.mintBalances[mintUrl] ?? 0,
  }));
  // NPC receive requires NUT-17 websockets (the npub.cash plugin subscribes
  // to quote settlement). The capability map carries the flag synchronously,
  // so non-NUT-17 mints are disabled ON THE FIRST FRAME — the async
  // enrichment (which re-checks against fresh mintInfo) then agrees instead
  // of re-shuffling rows. Unknown info (flag undefined) stays available;
  // enrichment is the authority there.
  const npcCandidates =
    event.scope === "npc"
      ? walletCtx.trustedMintUrls.map((mintUrl): MintCandidate => {
          const nut17 = walletCtx.mintMethodCapabilities?.[mintUrl]?.nut17;
          return {
            mintUrl,
            balance: walletCtx.mintBalances[mintUrl] ?? 0,
            ...(nut17 === false
              ? {
                  status: "disabled" as const,
                  reason: localizeReason("NO_WEBSOCKET"),
                }
              : {}),
          };
        })
      : null;
  const needsBalanceFilter =
    ctx.destination === "paymentRequest" ||
    ctx.destination === "meltQuote" ||
    ctx.destination === "sendEcash";
  const skipBalanceFilter =
    !needsBalanceFilter || persistOnly || event.scope === "selected";
  // Receive-rail picks list every trusted mint with unsupported ones DISABLED
  // (with the capability reason) rather than hidden — the user should see
  // which mints could serve the rail, mirroring the NPC NUT-17 treatment.
  const finalCandidates =
    methodScope && requirement
      ? buildMethodAwareMintCandidates(walletCtx, requirement, {})
      : (npcCandidates ??
        (methodCandidates
          ? hideMethodUnsupportedCandidates(methodCandidates)
          : skipBalanceFilter
            ? allTrustedCandidates
            : candidates));

  return logContextResult("request_mint_selector", {
    step: "selectMint",
    context: ctx,
    data: {
      candidates: finalCandidates,
      supportedMintUrls: ctx.supportedMintUrls,
      amount,
      unit: ctx.unit,
      paymentRequest: ctx.paymentRequest,
      meltTarget: ctx.meltTarget,
      destination: ctx.destination,
      scope: event.scope,
      mintQuoteMethod: ctx.mintQuoteMethod,
      meltQuoteMethod: ctx.meltQuoteMethod,
      methodRequirement: requirement ?? undefined,
    },
  });
}

export function resolveFromContext(
  ctx: FlowContext,
  walletCtx: WalletContext,
  enableEcashSendMemo = false,
): ContextResolutionResult {
  const destination = ctx.destination ?? "sendEcash";
  const unit = ctx.unit;
  const amount = ctx.amount;
  const mintUrl = ctx.mintUrl;
  logger.debug("contextResolution.resolve.start", {
    enableEcashSendMemo,
    resolvedDestination: destination,
    ...summarizeContext(ctx),
  });

  if (destination === "mintQuote") {
    if (amount == null || amount <= 0) {
      return logContextResult("mint_quote_enter_amount", {
        step: "enterAmount",
        context: { ...ctx, destination },
        data: {
          unit,
          preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
          constraints: {
            destination,
            methodContext: createAmountEntryMethodContext(walletCtx),
          },
        },
      });
    }
    if (
      mintUrl &&
      isMintValidForFlow(
        mintUrl,
        walletCtx,
        amount,
        ctx.supportedMintUrls,
        destination,
        ctx,
      )
    ) {
      return logContextResult("mint_quote_create_with_current_mint", {
        step: "createMintQuote",
        context: { ...ctx, destination },
        data: { mintUrl, amount, unit, method: ctx.mintQuoteMethod },
      });
    }

    const requirement = methodRequirementForDestination(destination, ctx, unit);
    const methodCandidates = requirement
      ? buildMethodCandidates(
          walletCtx,
          requirement,
          amount,
          ctx.supportedMintUrls,
          destination,
        )
      : null;
    const availableCandidates =
      methodCandidates?.filter(
        (candidate) => candidate.status !== "disabled",
      ) ?? [];
    if (methodCandidates && availableCandidates.length > 0) {
      return logContextResult(
        "mint_quote_select_mint_for_method",
        buildSelectMintRedirect(ctx, destination, methodCandidates, amount),
      );
    }

    if (!methodCandidates && !mintUrl) {
      const mint = walletCtx.preferredMintUrl;
      if (mint && walletCtx.trustedMintUrls.includes(mint)) {
        return logContextResult("mint_quote_create_with_preferred_mint", {
          step: "createMintQuote",
          context: { ...ctx, mintUrl: mint, destination },
          data: { mintUrl: mint, amount, unit, method: ctx.mintQuoteMethod },
        });
      }
    }
    const reason = methodCandidates?.find(
      (candidate) => candidate.reason,
    )?.reason;
    return logContextResult("mint_quote_no_valid_mint", {
      step: "error",
      context: { ...ctx, destination },
      data: {
        code: "NO_VALID_MINT",
        message:
          reason?.message ?? "No trusted mint supports this receive method",
      },
    });
  }

  if (destination === "receivePaymentRequest") {
    // Receive "as Ecash": a single-use NUT-18 request. No per-mint pick — the
    // operation embeds the trusted allow-list itself — so once we have an
    // amount we go straight to the auto-execution step. Mirrors the mintQuote
    // "enter amount first" guard.
    if (amount == null || amount <= 0) {
      return logContextResult("receive_payment_request_enter_amount", {
        step: "enterAmount",
        context: { ...ctx, destination },
        data: {
          unit,
          preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
          constraints: {
            destination,
            methodContext: createAmountEntryMethodContext(walletCtx),
          },
        },
      });
    }
    return logContextResult("receive_payment_request_create", {
      step: "createPaymentRequestReceive",
      context: { ...ctx, destination },
      data: { amount, unit },
    });
  }

  if (destination === "meltQuote") {
    if (!ctx.meltTarget) {
      return logContextResult("melt_quote_missing_target", {
        step: "error",
        context: ctx,
        data: {
          code: "MISSING_MELT_TARGET",
          message: "Missing melt target for melt quote flow",
        },
      });
    }
    if (amount == null || amount <= 0) {
      return logContextResult("melt_quote_enter_amount", {
        step: "enterAmount",
        context: { ...ctx, destination },
        data: {
          unit,
          preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
          constraints: {
            destination,
            meltTarget: ctx.meltTarget,
            methodContext: createAmountEntryMethodContext(walletCtx),
            recipientPubkey: ctx.recipientPubkey,
            recipientProfile: ctx.recipientProfile,
          },
        },
      });
    }
    const revalidated = revalidateMintForAmount(
      ctx,
      walletCtx,
      destination,
      amount,
    );
    if (revalidated.kind === "redirect") {
      return logContextResult(
        "melt_quote_revalidate_redirect",
        revalidated.result,
      );
    }
    return logContextResult("melt_quote_preview", {
      step: "navigateToMeltPreview",
      context: { ...ctx, mintUrl: revalidated.mintUrl, destination },
      data: {
        mintUrl: revalidated.mintUrl,
        meltTarget: ctx.meltTarget,
        unit,
        amount,
        recipientPubkey: ctx.recipientPubkey,
        recipientProfile: ctx.recipientProfile,
      },
    });
  }

  if (amount == null || amount <= 0) {
    return logContextResult("send_or_payment_enter_amount", {
      step: "enterAmount",
      context: { ...ctx, destination },
      data: {
        unit,
        preselectedMintUrl: mintUrl ?? walletCtx.preferredMintUrl,
        constraints: {
          destination,
          paymentRequest: ctx.paymentRequest,
          meltTarget: ctx.meltTarget,
          methodContext: createAmountEntryMethodContext(walletCtx),
          recipientPubkey: ctx.recipientPubkey,
          recipientProfile: ctx.recipientProfile,
          entrySource: ctx.entrySource,
        },
      },
    });
  }

  const revalidated = revalidateMintForAmount(
    ctx,
    walletCtx,
    destination,
    amount,
  );
  if (revalidated.kind === "redirect") {
    return logContextResult(
      "send_or_payment_revalidate_redirect",
      revalidated.result,
    );
  }
  const effectiveMintUrl = revalidated.mintUrl;

  if (destination === "sendEcash" && !ctx.p2pkLockPubkey) {
    // Locked sends skip local-proof routing entirely — local proofs cannot
    // carry a P2PK lock, so the flow proceeds to confirmSend where the
    // offline case fails fast instead of degrading to a bearer token.
    const proofAmounts = walletCtx.proofAmounts[effectiveMintUrl] ?? [];
    if (proofAmounts.length > 0 && ctx.offline) {
      const built = buildProofSuggestions(proofAmounts, amount);
      if (!built.exactMatch && built.hasSuggestion) {
        return logContextResult("send_ecash_choose_proofs", {
          step: "chooseProofs",
          context: { ...ctx, mintUrl: effectiveMintUrl, destination },
          data: buildChooseProofsData({
            mintUrl: effectiveMintUrl,
            amount,
            unit,
            proofAmounts,
            suggestions: built.suggestions,
            ctx: { ...ctx, mintUrl: effectiveMintUrl, destination },
          }),
        });
      }
    }
  }

  if (destination === "paymentRequest" && ctx.paymentRequest) {
    return logContextResult("payment_request_preview", {
      step: "navigateToPaymentRequest",
      context: { ...ctx, mintUrl: effectiveMintUrl, destination },
      data: {
        mintUrl: effectiveMintUrl,
        paymentRequest: ctx.paymentRequest,
        unit,
        amount,
        recipientPubkey: ctx.recipientPubkey,
        recipientProfile: ctx.recipientProfile,
      },
    });
  }
  if (
    destination === "sendEcash" &&
    enableEcashSendMemo &&
    !ctx.sendMemoHandled
  ) {
    return logContextResult("send_ecash_enter_memo", {
      step: "enterSendMemo",
      context: { ...ctx, mintUrl: effectiveMintUrl, destination },
      data: {
        mintUrl: effectiveMintUrl,
        amount,
        unit,
        ...(ctx.memo ? { memo: ctx.memo } : {}),
      },
    });
  }
  return logContextResult("send_ecash_confirm", {
    step: "confirmSend",
    context: { ...ctx, mintUrl: effectiveMintUrl, destination },
    data: {
      mintUrl: effectiveMintUrl,
      amount,
      ...(ctx.memo ? { memo: ctx.memo } : {}),
    },
  });
}
