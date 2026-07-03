import { localizeReason, type LocalizedReason } from "./formatting/locales";
import { logger, mintUrlFields } from "./logger";
import type {
  AmountEntryConstraints,
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
const METHODS: readonly MintPaymentMethod[] = ["bolt11", "bolt12", "onchain"];

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

  const minAmount = readAmountBound(match.min_amount ?? match.minAmount);
  const maxAmount = readAmountBound(match.max_amount ?? match.maxAmount);
  return {
    ...base,
    supported: true,
    ...(minAmount != null ? { minAmount } : {}),
    ...(maxAmount != null ? { maxAmount } : {}),
  };
}

/** NUT-04/05 amount bounds are optional and untrusted input — numbers only. */
function readAmountBound(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/** NUT-17 websocket support — tri-state: undefined when info is absent. */
function readNut17Support(mintInfo: unknown): boolean | undefined {
  if (!isRecord(mintInfo)) return undefined;
  const nuts = mintInfo.nuts;
  if (!isRecord(nuts)) return undefined;
  const nut17 = nuts["17"] ?? nuts.nut17;
  if (!isRecord(nut17)) return false;
  const supported = nut17.supported;
  return Array.isArray(supported) && supported.length > 0;
}

export function deriveMintMethodSupportFromInfo(
  mintInfo: unknown,
  unit: string = DEFAULT_UNIT,
  keysetUnits?: readonly string[],
): MintMethodSupport {
  // A mint can only issue units it has keysets for. Some mints advertise
  // NUT-04/05 method-units they cannot serve (e.g. chorus lists bolt11/usd
  // with sat-only keysets and coco then throws "No valid keysets found"), so
  // when the caller knows the mint's actual keyset units, an unbacked unit
  // overrides the advertisement. undefined = unknown → trust the info.
  const normalizedUnit = normalizeUnit(unit);
  const unitIssued =
    keysetUnits == null ||
    keysetUnits.some((entry) => normalizeUnit(entry) === normalizedUnit);
  const readGated = (nut: 4 | 5, method: MintPaymentMethod) => {
    const capability = readCapability(mintInfo, nut, method, unit);
    if (unitIssued || !capability.supported) return capability;
    return {
      disabled: false,
      method,
      unit: normalizedUnit,
      supported: false,
      reason: `Mint advertises ${normalizedUnit} but has no ${normalizedUnit} keysets`,
    };
  };
  const support = {
    mint: Object.fromEntries(
      METHODS.map((method) => [method, readGated(4, method)]),
    ),
    melt: Object.fromEntries(
      METHODS.map((method) => [method, readGated(5, method)]),
    ),
    nut17: readNut17Support(mintInfo),
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

/**
 * Display order for mint pickers: available mints first, then by balance
 * (descending), ties keep their incoming (trusted) order. This is THE sort
 * for every "Select Mint" list — the machine's synchronous fallback rows,
 * the async enriched rows, and the candidates in step data all use it, so
 * the FIRST render is already in the final order and enrichment never
 * re-shuffles rows.
 */
export function compareMintDisplayOrder(
  a: { status?: "available" | "disabled"; balance: number },
  b: { status?: "available" | "disabled"; balance: number },
): number {
  const aDisabled = a.status === "disabled";
  const bDisabled = b.status === "disabled";
  if (aDisabled !== bDisabled) return aDisabled ? 1 : -1;
  return b.balance - a.balance;
}

/** Units the wallet's unit switcher may offer, in display order. */
export const SWITCHABLE_UNITS = ["sat", "usd", "eur", "gbp"] as const;
export type SwitchableUnit = (typeof SWITCHABLE_UNITS)[number];

/**
 * Units a mint advertises for minting (NUT-04 method-unit entries),
 * restricted to the wallet's switchable set. Falls back to sat when the
 * mint publishes no parseable method-unit metadata.
 */
export function deriveSupportedUnitsFromInfo(
  mintInfo: unknown,
  keysetUnits?: readonly string[],
): string[] {
  const settings = getNutSettings(mintInfo, 4);
  const methods = settings?.methods;
  if (!Array.isArray(methods)) return [DEFAULT_UNIT];
  // A mint can only issue units it has keysets for — advertised NUT-04
  // units without a backing keyset are dropped when keysetUnits is known
  // (undefined = unknown → trust the advertisement).
  const issued =
    keysetUnits == null
      ? null
      : new Set(keysetUnits.map((unit) => normalizeUnit(unit)));
  const units = new Set<string>();
  for (const entry of methods) {
    if (!isRecord(entry)) continue;
    const unit =
      typeof entry.unit === "string" ? normalizeUnit(entry.unit) : null;
    if (
      unit &&
      (SWITCHABLE_UNITS as readonly string[]).includes(unit) &&
      (issued == null || issued.has(unit))
    ) {
      units.add(unit);
    }
  }
  if (units.size === 0) units.add(DEFAULT_UNIT);
  return [...units];
}

/**
 * The unit to land on when the preferred mint changes and the active unit
 * isn't among the mint's supported units: the supported unit holding the
 * highest balance AT THAT MINT, tie-broken by SWITCHABLE_UNITS display order
 * (sat first). Falls back to sat when the supported list is empty.
 */
export function pickHighestBalanceUnit(
  supportedUnits: readonly string[],
  balanceByUnit: Record<string, number>,
): string {
  const ordered = SWITCHABLE_UNITS.filter((unit) =>
    supportedUnits.includes(unit),
  );
  if (ordered.length === 0) return DEFAULT_UNIT;
  let best: string = ordered[0];
  for (const unit of ordered) {
    if ((balanceByUnit[unit] ?? 0) > (balanceByUnit[best] ?? 0)) best = unit;
  }
  logger.debug("mintCapabilities.pickHighestBalanceUnit", {
    supported: ordered.join(","),
    picked: best,
  });
  return best;
}

/**
 * The mint to prefer when the user switches to a unit the current preferred
 * mint doesn't support: the trusted mint advertising the unit with the
 * highest balance IN THAT UNIT. Null when no trusted mint supports it (the
 * unit may still be reachable via held balances at an untrusted mint).
 */
export function pickMintForUnit(
  mints: readonly {
    mintUrl: string;
    mintInfo?: unknown;
    keysetUnits?: readonly string[];
  }[],
  unit: string,
  balanceByMint: Record<string, number>,
): string | null {
  const normalized = normalizeUnit(unit);
  const candidates = mints.filter((mint) =>
    deriveSupportedUnitsFromInfo(mint.mintInfo, mint.keysetUnits).includes(
      normalized,
    ),
  );
  if (candidates.length === 0) {
    logger.debug("mintCapabilities.pickMintForUnit.none", { unit: normalized });
    return null;
  }
  let best = candidates[0];
  for (const mint of candidates) {
    if (
      (balanceByMint[mint.mintUrl] ?? 0) > (balanceByMint[best.mintUrl] ?? 0)
    ) {
      best = mint;
    }
  }
  logger.debug("mintCapabilities.pickMintForUnit.picked", {
    unit: normalized,
    candidateCount: candidates.length,
    ...mintUrlFields(best.mintUrl),
  });
  return best.mintUrl;
}

export interface ReceiveMethodMintResolution {
  mintUrl: string | null;
  source: "explicit" | "auto" | "none";
}

/**
 * Resolve the mint backing a standing receive rail (Bolt12 offer / Onchain
 * address). Policy: an EXPLICIT user pick is honored while that mint is
 * still trusted (even if it stopped advertising the method — the rail shows
 * its unsupported state rather than silently moving the user's choice);
 * otherwise AUTO-pick the first trusted mint supporting the method. The
 * auto pick is derived, never persisted — untrusting that mint self-heals
 * to the next supporting one. The rails never fall back to the preferred
 * or npub.cash mints; the four selections are independent.
 */
export function resolveReceiveMethodMint(
  ctx: Pick<WalletContext, "trustedMintUrls" | "mintMethodCapabilities">,
  explicitMintUrl: string | undefined,
  requirement: MintMethodRequirement,
): ReceiveMethodMintResolution {
  if (explicitMintUrl && ctx.trustedMintUrls.includes(explicitMintUrl)) {
    logger.debug("mintCapabilities.receiveMethodMint.explicit", {
      method: requirement.method,
      unit: normalizeUnit(requirement.unit),
    });
    return { mintUrl: explicitMintUrl, source: "explicit" };
  }
  const auto = ctx.trustedMintUrls.find((mintUrl) => {
    const capability = getMintMethodCapability(ctx, mintUrl, requirement);
    return capability.supported && !capability.disabled;
  });
  logger.debug("mintCapabilities.receiveMethodMint.derived", {
    method: requirement.method,
    unit: normalizeUnit(requirement.unit),
    source: auto ? "auto" : "none",
    hadStaleExplicit: !!explicitMintUrl,
  });
  return auto
    ? { mintUrl: auto, source: "auto" }
    : { mintUrl: null, source: "none" };
}

export function deriveMintMethodCapabilityMapFromTrustedMints(
  trustedMints: readonly {
    mintUrl: string;
    mintInfo?: unknown;
    /** Units the mint actually has keysets for; undefined = unknown. */
    keysetUnits?: readonly string[];
  }[],
  unit: string = DEFAULT_UNIT,
): MintMethodCapabilityMap {
  const map = Object.fromEntries(
    trustedMints.map((mint) => [
      mint.mintUrl,
      deriveMintMethodSupportFromInfo(mint.mintInfo, unit, mint.keysetUnits),
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
  // coco v2: bolt11 mint+melt, onchain mint+melt, bolt12 mint (reusable
  // offers). Bolt12 SEND (paying an offer) is not wired into the app yet.
  if (requirement.method === "bolt12") return requirement.operation === "mint";
  return true;
}

function methodLabel(method: MintPaymentMethod): string {
  if (method === "bolt11") return "Lightning";
  if (method === "bolt12") return "BOLT 12";
  return "onchain";
}

function operationLabel(operation: MintPaymentOperation): string {
  return operation === "mint" ? "receive" : "send";
}

export function getCapabilityUnavailableReason(
  capability: MintMethodUnitCapability,
  requirement: MintMethodRequirement,
  amount?: number,
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
  if (amount != null && amount > 0) {
    if (capability.minAmount != null && amount < capability.minAmount) {
      logger.debug("mintCapabilities.unavailable.belowMin", {
        operation: requirement.operation,
        method: requirement.method,
        unit: normalizeUnit(requirement.unit),
        amount,
        minAmount: capability.minAmount,
      });
      return localizeReason("AMOUNT_BELOW_MINT_MIN", locale, {
        min: capability.minAmount,
        unit: capability.unit,
      });
    }
    if (capability.maxAmount != null && amount > capability.maxAmount) {
      logger.debug("mintCapabilities.unavailable.aboveMax", {
        operation: requirement.operation,
        method: requirement.method,
        unit: normalizeUnit(requirement.unit),
        amount,
        maxAmount: capability.maxAmount,
      });
      return localizeReason("AMOUNT_ABOVE_MINT_MAX", locale, {
        max: capability.maxAmount,
        unit: capability.unit,
      });
    }
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
  /**
   * Set when the amount alone rules out every candidate: at least one mint
   * supports the method but the amount falls outside its advertised NUT-04/05
   * bounds. Carries the LEAST strict bound across those mints (smallest
   * minimum / largest maximum) so "the smallest onchain mint wants 1 000 sat"
   * is what the user reads — not the bound of an arbitrary stricter mint.
   */
  amountBoundsReason: LocalizedReason | null;
}

function pickAmountBoundsReason(
  candidates: readonly MintCandidate[],
): LocalizedReason | null {
  const boundsParam = (reason: LocalizedReason): number | null => {
    const value =
      reason.code === "AMOUNT_BELOW_MINT_MIN"
        ? reason.params?.min
        : reason.params?.max;
    return typeof value === "number" ? value : null;
  };
  let best: LocalizedReason | null = null;
  for (const candidate of candidates) {
    const reason = candidate.reason;
    if (
      !reason ||
      (reason.code !== "AMOUNT_BELOW_MINT_MIN" &&
        reason.code !== "AMOUNT_ABOVE_MINT_MAX")
    ) {
      continue;
    }
    if (!best) {
      best = reason;
      continue;
    }
    // Below-min beats above-max only in that we keep the first kind seen;
    // within a kind, prefer the least strict bound (lowest min, highest max).
    if (best.code !== reason.code) continue;
    const bestValue = boundsParam(best);
    const nextValue = boundsParam(reason);
    if (bestValue == null || nextValue == null) continue;
    const nextIsLessStrict =
      reason.code === "AMOUNT_BELOW_MINT_MIN"
        ? nextValue < bestValue
        : nextValue > bestValue;
    if (nextIsLessStrict) best = reason;
  }
  return best;
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
  const amountBoundsReason =
    availableCandidates.length === 0 ? pickAmountBoundsReason(candidates) : null;

  logger.info("mintCapabilities.amountAvailability.result", {
    candidateCount: candidates.length,
    availableCount: availableCandidates.length,
    hasSelectedCandidate: !!selectedCandidate,
    selectedUnavailableReasonCode: selectedUnavailableReason?.code,
    firstUnavailableReasonCode: firstUnavailableReason?.code,
    amountBoundsReasonCode: amountBoundsReason?.code,
    operation: requirement.operation,
    method: requirement.method,
    unit: normalizeUnit(requirement.unit),
  });

  return {
    selectedCandidate,
    availableCandidates,
    selectedUnavailableReason,
    firstUnavailableReason,
    amountBoundsReason,
  };
}

export interface AmountEntryEnvelope {
  unit: string;
  /** Floor below which NO applicable method can proceed. null = no floor. */
  minAmount: number | null;
  /** Hard cap for typed input across applicable methods. null = uncapped. */
  maxAmount: number | null;
}

interface MethodBounds {
  min: number | null;
  max: number | null;
}

/**
 * Least-strict NUT-04/05 bounds for one method across the trusted mints that
 * support it: the smallest advertised minimum and the largest advertised
 * maximum. A supporting mint that publishes no bound on a side makes that
 * side unbounded (null). Returns null when no trusted mint supports the
 * method at all — the rail cannot fire, so it must not constrain typing.
 */
function methodBounds(
  ctx: Pick<WalletContext, "trustedMintUrls" | "mintMethodCapabilities">,
  requirement: MintMethodRequirement,
): MethodBounds | null {
  let supported = false;
  let min: number | null = null;
  let max: number | null = null;
  let minUnbounded = false;
  let maxUnbounded = false;
  for (const mintUrl of ctx.trustedMintUrls) {
    const capability = getMintMethodCapability(ctx, mintUrl, requirement);
    if (!capability.supported || capability.disabled) continue;
    supported = true;
    if (capability.minAmount == null) minUnbounded = true;
    else min = min == null ? capability.minAmount : Math.min(min, capability.minAmount);
    if (capability.maxAmount == null) maxUnbounded = true;
    else max = max == null ? capability.maxAmount : Math.max(max, capability.maxAmount);
  }
  if (!supported) return null;
  return { min: minUnbounded ? null : min, max: maxUnbounded ? null : max };
}

/**
 * The typed-input envelope for amount entry, per destination: the range
 * outside which NO rail in the Next menu could serve the amount, in minor
 * units of `unit`. The keypad hard-caps at `maxAmount`; `minAmount` gates
 * Next (mid-entry values are transiently below any minimum, so typing is
 * never blocked on the low side).
 *
 * Rails mirror amountEntryAvailability's menu. Ecash rails (NUT-18 receive,
 * token send, payment request) have no NUT-04/05 bounds, so any destination
 * that offers one is uncapped on both sides. In practice only `meltQuote`
 * (Lightning-only) yields a real envelope today.
 */
export function getUnitAmountEnvelope(
  ctx: Pick<WalletContext, "trustedMintUrls" | "mintMethodCapabilities">,
  unit: string,
  destination: AmountEntryConstraints["destination"] | undefined,
): AmountEntryEnvelope {
  const normalizedUnit = normalizeUnit(unit);
  const uncapped: AmountEntryEnvelope = {
    unit: normalizedUnit,
    minAmount: null,
    maxAmount: null,
  };

  let requirements: MintMethodRequirement[];
  if (destination === "meltQuote") {
    // Lightning is the only executable spend rail; onchain send is listed
    // but forced unavailable ("not supported yet") and must not constrain.
    requirements = [
      { operation: "melt", method: "bolt11", unit: normalizedUnit },
    ];
  } else if (destination === "mintQuote") {
    // Receive offers "as Ecash" (NUT-18 payment request — unbounded)
    // whenever a trusted mint exists, so the envelope only bites when the
    // user has no trusted mints, i.e. never.
    if (ctx.trustedMintUrls.length > 0) {
      logger.debug("amount.envelope.resolved", {
        unit: normalizedUnit,
        destination,
        min: null,
        max: null,
        rail: "ecash",
      });
      return uncapped;
    }
    requirements = [
      { operation: "mint", method: "bolt11", unit: normalizedUnit },
      { operation: "mint", method: "onchain", unit: normalizedUnit },
    ];
  } else {
    // sendEcash / paymentRequest (ecash rails, balance-bound only) and
    // unknown destinations: never clamp typing.
    logger.debug("amount.envelope.resolved", {
      unit: normalizedUnit,
      destination: destination ?? null,
      min: null,
      max: null,
      rail: "ecash",
    });
    return uncapped;
  }

  const bounds = requirements
    .filter((requirement) => isMethodImplemented(requirement))
    .map((requirement) => methodBounds(ctx, requirement))
    .filter((entry): entry is MethodBounds => entry != null);
  // No rail can fire at any amount — availability gates Next; clamping the
  // keypad to an empty range would just fight the user.
  if (bounds.length === 0) return uncapped;

  const minAmount = bounds.some((entry) => entry.min == null)
    ? null
    : Math.min(...bounds.map((entry) => entry.min as number));
  const maxAmount = bounds.some((entry) => entry.max == null)
    ? null
    : Math.max(...bounds.map((entry) => entry.max as number));
  logger.debug("amount.envelope.resolved", {
    unit: normalizedUnit,
    destination,
    min: minAmount,
    max: maxAmount,
    railCount: bounds.length,
  });
  return { unit: normalizedUnit, minAmount, maxAmount };
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
