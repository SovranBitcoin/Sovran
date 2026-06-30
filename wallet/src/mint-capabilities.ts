import { localizeReason, type LocalizedReason } from "./formatting/locales";
import { logger, mintUrlFields } from "./logger";
import type {
  AmountEntryMethodContext,
  MintCandidate,
  MintMethodCapabilityMap,
  MintMethodRequirement,
  MintMethodSupport,
  MintMethodUnitCapability,
  MintPaymentMethod,
  MintPaymentOperation,
  WalletContext,
} from "./types";

const DEFAULT_UNIT = "sat";
const METHODS: readonly MintPaymentMethod[] = ["bolt11", "onchain"];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalizeUnit(unit: string | undefined): string {
  return (unit || DEFAULT_UNIT).trim().toLowerCase();
}

function getNutSettings(
  mintInfo: unknown,
  nut: 4 | 5,
): UnknownRecord | undefined {
  if (!isRecord(mintInfo)) return undefined;
  const nuts = mintInfo.nuts;
  if (!isRecord(nuts)) return undefined;
  const direct = nuts[String(nut)];
  if (isRecord(direct)) return direct;
  const padded = nuts[`nut${String(nut).padStart(2, "0")}`];
  return isRecord(padded) ? padded : undefined;
}

function methodToString(method: unknown): string | null {
  if (typeof method === "string") return method;
  if (!isRecord(method)) return null;
  const known = method.Known ?? method.known ?? method.type ?? method.value;
  return typeof known === "string" ? known : null;
}

function readCapability(
  mintInfo: unknown,
  nut: 4 | 5,
  method: MintPaymentMethod,
  unit: string,
): MintMethodUnitCapability {
  const normalizedUnit = normalizeUnit(unit);
  const settings = getNutSettings(mintInfo, nut);
  const base = {
    disabled: false,
    method,
    unit: normalizedUnit,
  };

  if (settings?.disabled === true) {
    return {
      ...base,
      supported: false,
      disabled: true,
      reason: `NUT-${nut} is disabled`,
    };
  }

  const methods = settings?.methods;
  if (!Array.isArray(methods)) {
    return {
      ...base,
      supported: false,
      reason: `NUT-${nut} method-unit metadata is missing for unit ${normalizedUnit}`,
    };
  }

  const match = methods.find((entry) => {
    if (!isRecord(entry)) return false;
    const entryMethod = methodToString(entry.method);
    const entryUnit =
      typeof entry.unit === "string" ? normalizeUnit(entry.unit) : null;
    return entryMethod === method && entryUnit === normalizedUnit;
  });

  if (!isRecord(match)) {
    return {
      ...base,
      supported: false,
      reason: `NUT-${nut} method ${method} does not support unit ${normalizedUnit}`,
    };
  }

  return {
    ...base,
    supported: true,
  };
}

export function deriveMintMethodSupportFromInfo(
  mintInfo: unknown,
  unit: string = DEFAULT_UNIT,
): MintMethodSupport {
  const support = {
    mint: Object.fromEntries(
      METHODS.map((method) => [
        method,
        readCapability(mintInfo, 4, method, unit),
      ]),
    ),
    melt: Object.fromEntries(
      METHODS.map((method) => [
        method,
        readCapability(mintInfo, 5, method, unit),
      ]),
    ),
  };
  logger.debug("mintCapabilities.deriveSupport", {
    unit: normalizeUnit(unit),
    hasMintInfo: isRecord(mintInfo),
    mintSupported: Object.values(support.mint).filter(
      (capability) => capability?.supported,
    ).length,
    meltSupported: Object.values(support.melt).filter(
      (capability) => capability?.supported,
    ).length,
  });
  return support;
}

export function deriveMintMethodCapabilityMapFromTrustedMints(
  trustedMints: readonly { mintUrl: string; mintInfo?: unknown }[],
  unit: string = DEFAULT_UNIT,
): MintMethodCapabilityMap {
  const map = Object.fromEntries(
    trustedMints.map((mint) => [
      mint.mintUrl,
      deriveMintMethodSupportFromInfo(mint.mintInfo, unit),
    ]),
  );
  logger.info("mintCapabilities.deriveMap", {
    mintCount: trustedMints.length,
    unit: normalizeUnit(unit),
  });
  return map;
}

function missingCapability(
  requirement: MintMethodRequirement,
): MintMethodUnitCapability {
  const unit = normalizeUnit(requirement.unit);
  return {
    supported: false,
    disabled: false,
    method: requirement.method,
    unit,
    reason: `NUT method-unit metadata is missing for unit ${unit}`,
  };
}

export function getMintMethodCapability(
  ctx: Pick<WalletContext, "mintMethodCapabilities">,
  mintUrl: string,
  requirement: MintMethodRequirement,
): MintMethodUnitCapability {
  const support =
    ctx.mintMethodCapabilities?.[mintUrl]?.[requirement.operation]?.[
      requirement.method
    ];
  if (!support) {
    logger.debug("mintCapabilities.lookup.missing", {
      ...mintUrlFields(mintUrl),
      operation: requirement.operation,
      method: requirement.method,
      unit: normalizeUnit(requirement.unit),
    });
  }
  return support ?? missingCapability(requirement);
}

export function isMethodImplemented(
  requirement: MintMethodRequirement,
): boolean {
  if (requirement.method === "onchain") return false;
  return true;
}

function methodLabel(method: MintPaymentMethod): string {
  return method === "bolt11" ? "Lightning" : "onchain";
}

function operationLabel(operation: MintPaymentOperation): string {
  return operation === "mint" ? "receive" : "send";
}

export function getCapabilityUnavailableReason(
  capability: MintMethodUnitCapability,
  requirement: MintMethodRequirement,
  _amount?: number,
  locale: string = "en",
): LocalizedReason | null {
  if (!isMethodImplemented(requirement)) {
    logger.debug("mintCapabilities.unavailable.notImplemented", {
      operation: requirement.operation,
      method: requirement.method,
      unit: normalizeUnit(requirement.unit),
    });
    return {
      code: "PAYMENT_METHOD_NOT_IMPLEMENTED",
      message: `${methodLabel(requirement.method)} ${operationLabel(requirement.operation)} is not supported yet`,
    };
  }
  if (capability.disabled) {
    logger.debug("mintCapabilities.unavailable.disabled", {
      operation: requirement.operation,
      method: requirement.method,
      unit: normalizeUnit(requirement.unit),
    });
    return localizeReason("MINT_METHOD_DISABLED", locale);
  }
  if (!capability.supported) {
    logger.debug("mintCapabilities.unavailable.unsupported", {
      operation: requirement.operation,
      method: requirement.method,
      unit: normalizeUnit(requirement.unit),
    });
    return {
      code: "MINT_METHOD_UNSUPPORTED",
      message: `Mint does not support ${methodLabel(requirement.method)} ${operationLabel(
        requirement.operation,
      )}`,
    };
  }
  return null;
}

export function isMintMethodCompatible(
  ctx: Pick<WalletContext, "mintMethodCapabilities">,
  mintUrl: string,
  requirement: MintMethodRequirement,
  amount?: number,
): boolean {
  const capability = getMintMethodCapability(ctx, mintUrl, requirement);
  return (
    getCapabilityUnavailableReason(capability, requirement, amount) == null
  );
}

export function hasMintSupportingMethod(
  ctx: Pick<WalletContext, "trustedMintUrls" | "mintMethodCapabilities">,
  requirement: MintMethodRequirement,
): boolean {
  const result = ctx.trustedMintUrls.some((mintUrl) => {
    const capability = getMintMethodCapability(ctx, mintUrl, requirement);
    return capability.supported && !capability.disabled;
  });
  logger.debug("mintCapabilities.hasSupportingMint", {
    trustedMintCount: ctx.trustedMintUrls.length,
    operation: requirement.operation,
    method: requirement.method,
    unit: normalizeUnit(requirement.unit),
    result,
  });
  return result;
}

export function hasCompatibleMintForMethod(
  ctx: Pick<
    WalletContext,
    "trustedMintUrls" | "mintBalances" | "mintMethodCapabilities"
  >,
  requirement: MintMethodRequirement,
  options: {
    amount?: number;
    allowedMints?: string[];
    requireBalance?: boolean;
  } = {},
): boolean {
  return buildMethodAwareMintCandidates(ctx, requirement, options).some(
    (candidate) => candidate.status !== "disabled",
  );
}

export function buildMethodAwareMintCandidates(
  ctx: Pick<
    WalletContext,
    "trustedMintUrls" | "mintBalances" | "mintMethodCapabilities"
  >,
  requirement: MintMethodRequirement,
  options: {
    amount?: number;
    allowedMints?: string[];
    requireBalance?: boolean;
    locale?: string;
  } = {},
): MintCandidate[] {
  const allowedSet = options.allowedMints?.length
    ? new Set(options.allowedMints)
    : null;
  const amount = options.amount;

  logger.debug("mintCapabilities.buildCandidates.start", {
    trustedMintCount: ctx.trustedMintUrls.length,
    allowedMintCount: options.allowedMints?.length ?? 0,
    hasAmount: amount != null && amount > 0,
    requireBalance: !!options.requireBalance,
    operation: requirement.operation,
    method: requirement.method,
    unit: normalizeUnit(requirement.unit),
  });

  const candidates = ctx.trustedMintUrls.map((mintUrl) => {
    const balance = ctx.mintBalances[mintUrl] ?? 0;
    let reason: LocalizedReason | null = null;

    if (allowedSet && !allowedSet.has(mintUrl)) {
      reason = localizeReason("NOT_IN_PAYMENT_REQUEST", options.locale);
    } else {
      const capability = getMintMethodCapability(ctx, mintUrl, requirement);
      reason = getCapabilityUnavailableReason(
        capability,
        requirement,
        amount,
        options.locale,
      );
    }

    if (!reason && options.requireBalance) {
      if (amount != null && amount > 0 && balance < amount) {
        reason = localizeReason("INSUFFICIENT_BALANCE", options.locale);
      } else if ((amount == null || amount <= 0) && balance <= 0) {
        reason = localizeReason("NO_BALANCE", options.locale);
      }
    }

    return {
      mintUrl,
      balance,
      status: reason ? ("disabled" as const) : ("available" as const),
      reason,
    };
  });
  logger.info("mintCapabilities.buildCandidates.result", {
    candidateCount: candidates.length,
    availableCount: candidates.filter(
      (candidate) => candidate.status !== "disabled",
    ).length,
    disabledCount: candidates.filter(
      (candidate) => candidate.status === "disabled",
    ).length,
    reasonCodes: candidates
      .map((candidate) => candidate.reason?.code)
      .filter((code): code is string => !!code),
    operation: requirement.operation,
    method: requirement.method,
    unit: normalizeUnit(requirement.unit),
  });
  return candidates;
}

export interface MintMethodAmountAvailability {
  selectedCandidate: MintCandidate | null;
  availableCandidates: MintCandidate[];
  selectedUnavailableReason: LocalizedReason | null;
  firstUnavailableReason: LocalizedReason | null;
}

export function evaluateMintMethodAmountAvailability(
  ctx: Pick<
    WalletContext,
    "trustedMintUrls" | "mintBalances" | "mintMethodCapabilities"
  >,
  requirement: MintMethodRequirement,
  options: {
    amount?: number;
    selectedMintUrl?: string;
    allowedMints?: string[];
    requireBalance?: boolean;
    locale?: string;
  } = {},
): MintMethodAmountAvailability {
  const candidates = buildMethodAwareMintCandidates(ctx, requirement, options);
  const selectedCandidate =
    options.selectedMintUrl && options.selectedMintUrl.length > 0
      ? (candidates.find(
          (candidate) => candidate.mintUrl === options.selectedMintUrl,
        ) ?? null)
      : null;
  const availableCandidates = candidates.filter(
    (candidate) => candidate.status !== "disabled",
  );
  const selectedUnavailableReason =
    selectedCandidate?.status === "disabled"
      ? (selectedCandidate.reason ?? null)
      : null;
  const firstUnavailableReason =
    selectedUnavailableReason ??
    candidates.find((candidate) => candidate.reason)?.reason ??
    null;

  logger.info("mintCapabilities.amountAvailability.result", {
    candidateCount: candidates.length,
    availableCount: availableCandidates.length,
    hasSelectedCandidate: !!selectedCandidate,
    selectedUnavailableReasonCode: selectedUnavailableReason?.code,
    firstUnavailableReasonCode: firstUnavailableReason?.code,
    operation: requirement.operation,
    method: requirement.method,
    unit: normalizeUnit(requirement.unit),
  });

  return {
    selectedCandidate,
    availableCandidates,
    selectedUnavailableReason,
    firstUnavailableReason,
  };
}

export function createAmountEntryMethodContext(
  ctx: WalletContext,
): AmountEntryMethodContext {
  logger.debug("mintCapabilities.createAmountEntryContext", {
    trustedMintCount: ctx.trustedMintUrls.length,
    balanceMintCount: Object.keys(ctx.mintBalances).length,
    hasPreferredMint: !!ctx.preferredMintUrl,
    hasMethodCapabilities: !!ctx.mintMethodCapabilities,
  });
  return {
    trustedMintUrls: ctx.trustedMintUrls,
    mintBalances: ctx.mintBalances,
    ...(ctx.preferredMintUrl ? { preferredMintUrl: ctx.preferredMintUrl } : {}),
    ...(ctx.mintMethodCapabilities
      ? { mintMethodCapabilities: ctx.mintMethodCapabilities }
      : {}),
  };
}

export function methodContextHasCompatibleMint(
  ctx: AmountEntryMethodContext | undefined,
  requirement: MintMethodRequirement,
  amount?: number,
  options: { requireBalance?: boolean } = {},
): boolean {
  if (!ctx) {
    const result = requirement.method === "bolt11";
    logger.debug("mintCapabilities.methodContext.compatible.default", {
      operation: requirement.operation,
      method: requirement.method,
      result,
    });
    return result;
  }
  const result = hasCompatibleMintForMethod(ctx, requirement, {
    amount,
    requireBalance: options.requireBalance,
  });
  logger.debug("mintCapabilities.methodContext.compatible", {
    trustedMintCount: ctx.trustedMintUrls.length,
    operation: requirement.operation,
    method: requirement.method,
    hasAmount: amount != null && amount > 0,
    requireBalance: !!options.requireBalance,
    result,
  });
  return result;
}

export function methodContextHasSupportingMint(
  ctx: AmountEntryMethodContext | undefined,
  requirement: MintMethodRequirement,
): boolean {
  if (!ctx) {
    const result = requirement.method === "bolt11";
    logger.debug("mintCapabilities.methodContext.supporting.default", {
      operation: requirement.operation,
      method: requirement.method,
      result,
    });
    return result;
  }
  const result = hasMintSupportingMethod(ctx, requirement);
  logger.debug("mintCapabilities.methodContext.supporting", {
    trustedMintCount: ctx.trustedMintUrls.length,
    operation: requirement.operation,
    method: requirement.method,
    result,
  });
  return result;
}
