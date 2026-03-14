/**
 * Thin helpers that use coco-payment-ux composition primitives.
 * Produces the same shapes as the old offlineSendSuggestions for amount entry compatibility.
 */

import {
  composeSatoshis,
  composeFiat,
  getSatRangeForDisplayedFiatMinorUnit,
  buildExactOfflineAmountIndex,
} from 'coco-payment-ux';

const SATS_PER_BTC = 100_000_000;

export interface OfflineSendSuggestions {
  isRequestedAmountSendableOffline: boolean;
  roundDownAmount: number | null;
  roundUpAmount: number | null;
  totalReadyBalance: number;
}

export interface OfflineFiatSuggestionOption {
  amount: number;
  displayMinorUnit: number;
}

export interface OfflineFiatSendSuggestions {
  autoSelectAmount: number | null;
  requestedDisplayMinorUnit: number;
  roundDownOption: OfflineFiatSuggestionOption | null;
  roundUpOption: OfflineFiatSuggestionOption | null;
  totalReadyBalance: number;
}

export async function getOfflineSendSuggestions(
  proofService: {
    getReadyProofs: (mintUrl: string) => Promise<Array<{ amount: number }>>;
  },
  mintUrl: string,
  requestedAmount: number
): Promise<OfflineSendSuggestions> {
  const readyProofs = await proofService.getReadyProofs(mintUrl);
  const proofAmounts = readyProofs.map((p) => p.amount);
  const { totalReadyBalance } = buildExactOfflineAmountIndex(proofAmounts);

  if (totalReadyBalance === 0 || requestedAmount <= 0) {
    return {
      isRequestedAmountSendableOffline: false,
      roundDownAmount: null,
      roundUpAmount: null,
      totalReadyBalance,
    };
  }

  const composition = composeSatoshis(proofAmounts, requestedAmount);

  return {
    isRequestedAmountSendableOffline: composition.exactMatch,
    roundDownAmount: composition.exactMatch ? null : composition.nearestLower,
    roundUpAmount: composition.exactMatch ? null : composition.nearestUpper,
    totalReadyBalance,
  };
}

export async function getOfflineFiatSendSuggestions(
  proofService: {
    getReadyProofs: (mintUrl: string) => Promise<Array<{ amount: number }>>;
  },
  mintUrl: string,
  requestedAmount: number,
  requestedDisplayMinorUnit: number,
  btcPrice: number,
  minorUnitsPerUnit: number = 100
): Promise<OfflineFiatSendSuggestions> {
  const readyProofs = await proofService.getReadyProofs(mintUrl);
  const proofAmounts = readyProofs.map((p) => p.amount);
  const { totalReadyBalance } = buildExactOfflineAmountIndex(proofAmounts);

  if (totalReadyBalance === 0 || requestedAmount <= 0 || btcPrice <= 0) {
    return {
      autoSelectAmount: null,
      requestedDisplayMinorUnit,
      roundDownOption: null,
      roundUpOption: null,
      totalReadyBalance,
    };
  }

  const satsPerFiat = SATS_PER_BTC / btcPrice;
  const fc = composeFiat(proofAmounts, requestedDisplayMinorUnit / minorUnitsPerUnit, satsPerFiat);

  const autoSelectAmount = fc.matchedSatoshis;

  const roundDownOption: OfflineFiatSuggestionOption | null = fc.nearestLowerFiat
    ? {
        amount: fc.nearestLowerFiat.satoshis,
        displayMinorUnit: Math.round(fc.nearestLowerFiat.fiat * minorUnitsPerUnit),
      }
    : null;

  const roundUpOption: OfflineFiatSuggestionOption | null = fc.nearestUpperFiat
    ? {
        amount: fc.nearestUpperFiat.satoshis,
        displayMinorUnit: Math.round(fc.nearestUpperFiat.fiat * minorUnitsPerUnit),
      }
    : null;

  return {
    autoSelectAmount,
    requestedDisplayMinorUnit,
    roundDownOption,
    roundUpOption,
    totalReadyBalance,
  };
}

export { buildExactOfflineAmountIndex, getSatRangeForDisplayedFiatMinorUnit };
