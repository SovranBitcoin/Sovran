// ---------------------------------------------------------------------------
// Amount Actions — pure resolution logic
//
// Given input mode + numeric value + proofs + btcPrice, resolves the effective
// satoshi amount and offline composition status. Returns CoreAmountResolution
// (the math output). The manager adds display fields on top.
// ---------------------------------------------------------------------------

import { composeFiat, composeSatoshis } from "../offline";
import { logger } from "../logger";
import type {
  AmountInputMode,
  AmountResolution,
  CoreAmountResolution,
} from "./types";

const SATS_PER_BTC = 100_000_000;

/**
 * Pure computation: resolve effective sat amount and offline status.
 * Returns CoreAmountResolution — the manager wraps this with display fields.
 */
export function resolveAmount(
  inputMode: AmountInputMode,
  rawInput: string,
  numericValue: number,
  proofAmounts: number[],
  btcPrice: number,
  offlineOptimization: boolean,
): CoreAmountResolution {
  logger.debug("amount.resolve.start", {
    inputMode,
    rawInputLength: rawInput.length,
    numericValue,
    proofCount: proofAmounts.length,
    proofTotal: proofAmounts.reduce((sum, amount) => sum + amount, 0),
    hasBtcPrice: btcPrice > 0,
    offlineOptimization,
  });

  if (numericValue <= 0) {
    const result = {
      inputMode,
      rawInput,
      numericValue,
      effectiveSatAmount: 0,
      canSendOffline: null,
      displayFiat: null,
      displaySats: 0,
      autoOptimized: false,
    };
    logger.debug("amount.resolve.zero", {
      inputMode,
      rawInputLength: rawInput.length,
    });
    return result;
  }

  if (inputMode === "sat") {
    return resolveSatMode(
      rawInput,
      numericValue,
      proofAmounts,
      btcPrice,
      offlineOptimization,
    );
  }

  return resolveFiatMode(
    rawInput,
    numericValue,
    proofAmounts,
    btcPrice,
    offlineOptimization,
  );
}

// ---------------------------------------------------------------------------
// Sat mode
// ---------------------------------------------------------------------------

function resolveSatMode(
  rawInput: string,
  sats: number,
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
    inputMode: "sat",
    rawInput,
    numericValue: sats,
    effectiveSatAmount: sats,
    canSendOffline,
    displayFiat,
    displaySats: sats,
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
// Fiat mode
// ---------------------------------------------------------------------------

function resolveFiatMode(
  rawInput: string,
  fiatAmount: number,
  proofAmounts: number[],
  btcPrice: number,
  offlineOptimization: boolean,
): CoreAmountResolution {
  if (btcPrice <= 0) {
    const result: CoreAmountResolution = {
      inputMode: "fiat",
      rawInput,
      numericValue: fiatAmount,
      effectiveSatAmount: 0,
      canSendOffline: null,
      displayFiat: fiatAmount,
      displaySats: 0,
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
      effectiveSatAmount: centerSats,
      canSendOffline: null,
      displayFiat: fiatAmount,
      displaySats: centerSats,
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
      effectiveSatAmount: fiatResult.matchedSatoshis,
      canSendOffline: true,
      displayFiat: fiatAmount,
      displaySats: fiatResult.matchedSatoshis,
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
    effectiveSatAmount: centerSats,
    canSendOffline: composition.exactMatch,
    displayFiat: fiatAmount,
    displaySats: centerSats,
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
    a.effectiveSatAmount === b.effectiveSatAmount &&
    a.canSendOffline === b.canSendOffline &&
    a.displayFiat === b.displayFiat &&
    a.displaySats === b.displaySats &&
    a.autoOptimized === b.autoOptimized &&
    a.unit === b.unit &&
    a.keyboardUnit === b.keyboardUnit &&
    a.secondaryDisplay === b.secondaryDisplay &&
    a.fiatCurrency === b.fiatCurrency &&
    a.fiatSymbol === b.fiatSymbol &&
    a.btcPrice === b.btcPrice &&
    a.suggestions === b.suggestions
  );
}
