// ---------------------------------------------------------------------------
// Amount Actions — pure resolution logic
//
// Given input mode + numeric value + unit + proofs + btcPrice, resolves the
// effective minor-unit amount and offline composition status. Returns
// CoreAmountResolution (the math output). The manager adds display fields.
// ---------------------------------------------------------------------------

import { composeFiat, composeSatoshis } from "../offline";
import { isFiatUnit, majorToMinor } from "../formatting/units";
import { logger } from "../logger";
import type {
  AmountInputMode,
  AmountResolution,
  CoreAmountResolution,
} from "./types";

const SATS_PER_BTC = 100_000_000;

interface ResolveAmountInput {
  inputMode: AmountInputMode;
  rawInput: string;
  /** Parsed major-denomination value of rawInput. */
  numericValue: number;
  /** Active account unit — the unit the effective amount is denominated in. */
  unit: string;
  /** Proof amounts at the selected mint, in the active unit's minor units. */
  proofAmounts: number[];
  /** Display-currency per BTC. Only used in 'fiat' mode (sat account). */
  btcPrice: number;
  offlineOptimization: boolean;
}

/**
 * Pure computation: resolve the effective minor-unit amount and offline
 * status. Returns CoreAmountResolution — the manager wraps display fields.
 */
export function resolveAmount(input: ResolveAmountInput): CoreAmountResolution {
  const {
    inputMode,
    rawInput,
    numericValue,
    unit,
    proofAmounts,
    btcPrice,
    offlineOptimization,
  } = input;
  logger.debug("amount.resolve.start", {
    inputMode,
    rawInputLength: rawInput.length,
    numericValue,
    unit,
    proofCount: proofAmounts.length,
    proofTotal: proofAmounts.reduce((sum, amount) => sum + amount, 0),
    hasBtcPrice: btcPrice > 0,
    offlineOptimization,
  });

  if (numericValue <= 0) {
    const result: CoreAmountResolution = {
      inputMode,
      rawInput,
      numericValue,
      effectiveAmount: { value: 0, unit },
      canSendOffline: null,
      displayFiat: null,
      displayAmount: 0,
      autoOptimized: false,
    };
    logger.debug("amount.resolve.zero", {
      inputMode,
      unit,
      rawInputLength: rawInput.length,
    });
    return result;
  }

  if (inputMode === "unit") {
    return isFiatUnit(unit)
      ? resolveFiatUnitMode(
          rawInput,
          numericValue,
          unit,
          proofAmounts,
          offlineOptimization,
        )
      : resolveSatUnitMode(
          rawInput,
          numericValue,
          unit,
          proofAmounts,
          btcPrice,
          offlineOptimization,
        );
  }

  return resolveFiatDisplayMode(
    rawInput,
    numericValue,
    unit,
    proofAmounts,
    btcPrice,
    offlineOptimization,
  );
}

// ---------------------------------------------------------------------------
// Unit mode — sat account (integer sats)
// ---------------------------------------------------------------------------

function resolveSatUnitMode(
  rawInput: string,
  sats: number,
  unit: string,
  proofAmounts: number[],
  btcPrice: number,
  offlineOptimization: boolean,
): CoreAmountResolution {
  const displayFiat =
    btcPrice > 0 ? roundFiat((sats / SATS_PER_BTC) * btcPrice) : null;

  let canSendOffline: boolean | null = null;
  if (offlineOptimization && proofAmounts.length > 0) {
    canSendOffline = composeSatoshis(proofAmounts, sats).exactMatch;
  }

  const result: CoreAmountResolution = {
    inputMode: "unit",
    rawInput,
    numericValue: sats,
    effectiveAmount: { value: sats, unit },
    canSendOffline,
    displayFiat,
    displayAmount: sats,
    autoOptimized: false,
  };
  logger.debug("amount.resolve.sat.result", {
    sats,
    displayFiat,
    canSendOffline,
    proofCount: proofAmounts.length,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Unit mode — fiat account (major-denomination entry → integer minor units)
// ---------------------------------------------------------------------------

function resolveFiatUnitMode(
  rawInput: string,
  majorValue: number,
  unit: string,
  proofAmounts: number[],
  offlineOptimization: boolean,
): CoreAmountResolution {
  // Cents are exact — no price conversion and no rounding window, so the
  // fiat-window offline optimization does not apply. Offline composition is
  // still a plain integer subset-sum over the unit's own proofs.
  const minor = majorToMinor(majorValue, unit);

  let canSendOffline: boolean | null = null;
  if (offlineOptimization && proofAmounts.length > 0 && minor > 0) {
    canSendOffline = composeSatoshis(proofAmounts, minor).exactMatch;
  }

  const result: CoreAmountResolution = {
    inputMode: "unit",
    rawInput,
    numericValue: majorValue,
    effectiveAmount: { value: minor, unit },
    canSendOffline,
    displayFiat: null,
    displayAmount: minor,
    autoOptimized: false,
  };
  logger.debug("amount.resolve.fiatUnit.result", {
    unit,
    majorValue,
    minor,
    canSendOffline,
    proofCount: proofAmounts.length,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Fiat display mode — sat account typing a display-currency amount
// ---------------------------------------------------------------------------

function resolveFiatDisplayMode(
  rawInput: string,
  fiatAmount: number,
  unit: string,
  proofAmounts: number[],
  btcPrice: number,
  offlineOptimization: boolean,
): CoreAmountResolution {
  if (btcPrice <= 0) {
    const result: CoreAmountResolution = {
      inputMode: "fiat",
      rawInput,
      numericValue: fiatAmount,
      effectiveAmount: { value: 0, unit },
      canSendOffline: null,
      displayFiat: fiatAmount,
      displayAmount: 0,
      autoOptimized: false,
    };
    logger.warn("amount.resolve.fiat.noPrice", {
      fiatAmount,
      proofCount: proofAmounts.length,
      offlineOptimization,
    });
    return result;
  }

  const satsPerFiat = SATS_PER_BTC / btcPrice;
  const centerSats = Math.round(fiatAmount * satsPerFiat);

  if (!offlineOptimization || proofAmounts.length === 0) {
    const result: CoreAmountResolution = {
      inputMode: "fiat",
      rawInput,
      numericValue: fiatAmount,
      effectiveAmount: { value: centerSats, unit },
      canSendOffline: null,
      displayFiat: fiatAmount,
      displayAmount: centerSats,
      autoOptimized: false,
    };
    logger.debug("amount.resolve.fiat.noOfflineOptimization", {
      fiatAmount,
      centerSats,
      proofCount: proofAmounts.length,
      offlineOptimization,
    });
    return result;
  }

  // Use composeFiat to find an offline-compatible sat amount in the fiat
  // rounding window. For example, $0.02 at $50k BTC maps to a sat range
  // of ~40-44. If any value in that range is exactly composable from
  // available proofs, we use it — making the send offline-compatible
  // without the user needing to change anything.
  const fiatResult = composeFiat(proofAmounts, fiatAmount, satsPerFiat);

  if (fiatResult.exactFiatMatch && fiatResult.matchedSatoshis !== null) {
    const result: CoreAmountResolution = {
      inputMode: "fiat",
      rawInput,
      numericValue: fiatAmount,
      effectiveAmount: { value: fiatResult.matchedSatoshis, unit },
      canSendOffline: true,
      displayFiat: fiatAmount,
      displayAmount: fiatResult.matchedSatoshis,
      autoOptimized: fiatResult.matchedSatoshis !== centerSats,
    };
    logger.debug("amount.resolve.fiat.offlineMatch", {
      fiatAmount,
      centerSats,
      matchedSatoshis: fiatResult.matchedSatoshis,
      autoOptimized: result.autoOptimized,
      proofCount: proofAmounts.length,
    });
    return result;
  }

  // No offline amount in fiat window — fall back to center of range
  const composition = composeSatoshis(proofAmounts, centerSats);
  const result: CoreAmountResolution = {
    inputMode: "fiat",
    rawInput,
    numericValue: fiatAmount,
    effectiveAmount: { value: centerSats, unit },
    canSendOffline: composition.exactMatch,
    displayFiat: fiatAmount,
    displayAmount: centerSats,
    autoOptimized: false,
  };
  logger.debug("amount.resolve.fiat.fallbackCenter", {
    fiatAmount,
    centerSats,
    canSendOffline: composition.exactMatch,
    proofCount: proofAmounts.length,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundFiat(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Shallow equality check for AmountResolution (full, including display fields).
 * Used by the manager to return stable references for useSyncExternalStore.
 */
export function resolutionEqual(
  a: AmountResolution,
  b: AmountResolution,
): boolean {
  return (
    a.inputMode === b.inputMode &&
    a.rawInput === b.rawInput &&
    a.numericValue === b.numericValue &&
    a.effectiveAmount.value === b.effectiveAmount.value &&
    a.effectiveAmount.unit === b.effectiveAmount.unit &&
    a.canSendOffline === b.canSendOffline &&
    a.displayFiat === b.displayFiat &&
    a.displayAmount === b.displayAmount &&
    a.autoOptimized === b.autoOptimized &&
    a.unit === b.unit &&
    a.keyboardUnit === b.keyboardUnit &&
    a.secondaryDisplay === b.secondaryDisplay &&
    a.fiatCurrency === b.fiatCurrency &&
    a.fiatSymbol === b.fiatSymbol &&
    a.unitSymbol === b.unitSymbol &&
    a.btcPrice === b.btcPrice &&
    a.suggestions === b.suggestions &&
    a.clampedToCap === b.clampedToCap &&
    (a.inputCap === b.inputCap ||
      (a.inputCap != null &&
        b.inputCap != null &&
        a.inputCap.value === b.inputCap.value &&
        a.inputCap.unit === b.inputCap.unit))
  );
}
