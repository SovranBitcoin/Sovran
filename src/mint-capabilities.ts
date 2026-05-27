import { localizeReason, type LocalizedReason } from './formatting/locales';
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
} from './types';

const DEFAULT_UNIT = 'sat';
const METHODS: readonly MintPaymentMethod[] = ['bolt11', 'onchain'];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function normalizeUnit(unit: string | undefined): string {
  return (unit || DEFAULT_UNIT).trim().toLowerCase();
}

function getNutSettings(mintInfo: unknown, nut: 4 | 5): UnknownRecord | undefined {
  if (!isRecord(mintInfo)) return undefined;
  const nuts = mintInfo.nuts;
  if (!isRecord(nuts)) return undefined;
  const direct = nuts[String(nut)];
  if (isRecord(direct)) return direct;
  const padded = nuts[`nut${String(nut).padStart(2, '0')}`];
  return isRecord(padded) ? padded : undefined;
}

function methodToString(method: unknown): string | null {
  if (typeof method === 'string') return method;
  if (!isRecord(method)) return null;
  const known = method.Known ?? method.known ?? method.type ?? method.value;
  return typeof known === 'string' ? known : null;
}

function readCapability(
  mintInfo: unknown,
  nut: 4 | 5,
  method: MintPaymentMethod,
  unit: string
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
    if (method === 'bolt11' && normalizedUnit === DEFAULT_UNIT) {
      return {
        ...base,
        supported: true,
        legacySatAllowed: true,
        reason: `NUT-${nut} method-unit metadata is missing; allowing legacy sat flow`,
      };
    }
    return {
      ...base,
      supported: false,
      reason: `NUT-${nut} method-unit metadata is missing for unit ${normalizedUnit}`,
    };
  }

  const match = methods.find((entry) => {
    if (!isRecord(entry)) return false;
    const entryMethod = methodToString(entry.method);
    const entryUnit = typeof entry.unit === 'string' ? normalizeUnit(entry.unit) : null;
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
  unit: string = DEFAULT_UNIT
): MintMethodSupport {
  return {
    mint: Object.fromEntries(
      METHODS.map((method) => [method, readCapability(mintInfo, 4, method, unit)])
    ),
    melt: Object.fromEntries(
      METHODS.map((method) => [method, readCapability(mintInfo, 5, method, unit)])
    ),
  };
}

export function deriveMintMethodCapabilityMapFromTrustedMints(
  trustedMints: readonly { mintUrl: string; mintInfo?: unknown }[],
  unit: string = DEFAULT_UNIT
): MintMethodCapabilityMap {
  return Object.fromEntries(
    trustedMints.map((mint) => [mint.mintUrl, deriveMintMethodSupportFromInfo(mint.mintInfo, unit)])
  );
}

function legacyCapability(requirement: MintMethodRequirement): MintMethodUnitCapability {
  const unit = normalizeUnit(requirement.unit);
  if (requirement.method === 'bolt11' && unit === DEFAULT_UNIT) {
    return {
      supported: true,
      disabled: false,
      method: requirement.method,
      unit,
      legacySatAllowed: true,
      reason: `NUT method-unit metadata is missing; allowing legacy sat flow`,
    };
  }
  return {
    supported: false,
    disabled: false,
    method: requirement.method,
    unit,
    reason: `NUT method-unit metadata is missing for unit ${unit}`,
  };
}

export function getMintMethodCapability(
  ctx: Pick<WalletContext, 'mintMethodCapabilities'>,
  mintUrl: string,
  requirement: MintMethodRequirement
): MintMethodUnitCapability {
  const support =
    ctx.mintMethodCapabilities?.[mintUrl]?.[requirement.operation]?.[requirement.method];
  return support ?? legacyCapability(requirement);
}

export function isMethodImplemented(requirement: MintMethodRequirement): boolean {
  if (requirement.method === 'onchain') return false;
  return true;
}

function methodLabel(method: MintPaymentMethod): string {
  return method === 'bolt11' ? 'Lightning' : 'onchain';
}

function operationLabel(operation: MintPaymentOperation): string {
  return operation === 'mint' ? 'receive' : 'send';
}

export function getCapabilityUnavailableReason(
  capability: MintMethodUnitCapability,
  requirement: MintMethodRequirement,
  _amount?: number,
  locale: string = 'en'
): LocalizedReason | null {
  if (!isMethodImplemented(requirement)) {
    return {
      code: 'PAYMENT_METHOD_NOT_IMPLEMENTED',
      message: `${methodLabel(requirement.method)} ${operationLabel(requirement.operation)} is not supported yet`,
    };
  }
  if (capability.disabled) return localizeReason('MINT_METHOD_DISABLED', locale);
  if (!capability.supported) {
    return {
      code: 'MINT_METHOD_UNSUPPORTED',
      message: `Mint does not support ${methodLabel(requirement.method)} ${operationLabel(
        requirement.operation
      )}`,
    };
  }
  return null;
}

export function isMintMethodCompatible(
  ctx: Pick<WalletContext, 'mintMethodCapabilities'>,
  mintUrl: string,
  requirement: MintMethodRequirement,
  amount?: number
): boolean {
  const capability = getMintMethodCapability(ctx, mintUrl, requirement);
  return getCapabilityUnavailableReason(capability, requirement, amount) == null;
}

export function hasMintSupportingMethod(
  ctx: Pick<WalletContext, 'trustedMintUrls' | 'mintMethodCapabilities'>,
  requirement: MintMethodRequirement
): boolean {
  return ctx.trustedMintUrls.some((mintUrl) => {
    const capability = getMintMethodCapability(ctx, mintUrl, requirement);
    return capability.supported && !capability.disabled;
  });
}

export function hasCompatibleMintForMethod(
  ctx: Pick<WalletContext, 'trustedMintUrls' | 'mintBalances' | 'mintMethodCapabilities'>,
  requirement: MintMethodRequirement,
  options: { amount?: number; allowedMints?: string[]; requireBalance?: boolean } = {}
): boolean {
  return buildMethodAwareMintCandidates(ctx, requirement, options).some(
    (candidate) => candidate.status !== 'disabled'
  );
}

export function buildMethodAwareMintCandidates(
  ctx: Pick<WalletContext, 'trustedMintUrls' | 'mintBalances' | 'mintMethodCapabilities'>,
  requirement: MintMethodRequirement,
  options: {
    amount?: number;
    allowedMints?: string[];
    requireBalance?: boolean;
    locale?: string;
  } = {}
): MintCandidate[] {
  const allowedSet = options.allowedMints?.length ? new Set(options.allowedMints) : null;
  const amount = options.amount;

  return ctx.trustedMintUrls.map((mintUrl) => {
    const balance = ctx.mintBalances[mintUrl] ?? 0;
    let reason: LocalizedReason | null = null;

    if (allowedSet && !allowedSet.has(mintUrl)) {
      reason = localizeReason('NOT_IN_PAYMENT_REQUEST', options.locale);
    } else {
      const capability = getMintMethodCapability(ctx, mintUrl, requirement);
      reason = getCapabilityUnavailableReason(capability, requirement, amount, options.locale);
    }

    if (!reason && options.requireBalance) {
      if (amount != null && amount > 0 && balance < amount) {
        reason = localizeReason('INSUFFICIENT_BALANCE', options.locale);
      } else if ((amount == null || amount <= 0) && balance <= 0) {
        reason = localizeReason('NO_BALANCE', options.locale);
      }
    }

    return {
      mintUrl,
      balance,
      status: reason ? ('disabled' as const) : ('available' as const),
      reason,
    };
  });
}

export interface MintMethodAmountAvailability {
  selectedCandidate: MintCandidate | null;
  availableCandidates: MintCandidate[];
  selectedUnavailableReason: LocalizedReason | null;
  firstUnavailableReason: LocalizedReason | null;
}

export function evaluateMintMethodAmountAvailability(
  ctx: Pick<WalletContext, 'trustedMintUrls' | 'mintBalances' | 'mintMethodCapabilities'>,
  requirement: MintMethodRequirement,
  options: {
    amount?: number;
    selectedMintUrl?: string;
    allowedMints?: string[];
    requireBalance?: boolean;
    locale?: string;
  } = {}
): MintMethodAmountAvailability {
  const candidates = buildMethodAwareMintCandidates(ctx, requirement, options);
  const selectedCandidate =
    options.selectedMintUrl && options.selectedMintUrl.length > 0
      ? (candidates.find((candidate) => candidate.mintUrl === options.selectedMintUrl) ?? null)
      : null;
  const availableCandidates = candidates.filter((candidate) => candidate.status !== 'disabled');
  const selectedUnavailableReason =
    selectedCandidate?.status === 'disabled' ? (selectedCandidate.reason ?? null) : null;
  const firstUnavailableReason =
    selectedUnavailableReason ?? candidates.find((candidate) => candidate.reason)?.reason ?? null;

  return {
    selectedCandidate,
    availableCandidates,
    selectedUnavailableReason,
    firstUnavailableReason,
  };
}

export function createAmountEntryMethodContext(ctx: WalletContext): AmountEntryMethodContext {
  return {
    trustedMintUrls: ctx.trustedMintUrls,
    mintBalances: ctx.mintBalances,
    ...(ctx.preferredMintUrl ? { preferredMintUrl: ctx.preferredMintUrl } : {}),
    ...(ctx.mintMethodCapabilities ? { mintMethodCapabilities: ctx.mintMethodCapabilities } : {}),
  };
}

export function methodContextHasCompatibleMint(
  ctx: AmountEntryMethodContext | undefined,
  requirement: MintMethodRequirement,
  amount?: number,
  options: { requireBalance?: boolean } = {}
): boolean {
  if (!ctx) return requirement.method === 'bolt11';
  return hasCompatibleMintForMethod(ctx, requirement, {
    amount,
    requireBalance: options.requireBalance,
  });
}

export function methodContextHasSupportingMint(
  ctx: AmountEntryMethodContext | undefined,
  requirement: MintMethodRequirement
): boolean {
  if (!ctx) return requirement.method === 'bolt11';
  return hasMintSupportingMethod(ctx, requirement);
}
