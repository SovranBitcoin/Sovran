import { useEffect, useRef, useState } from 'react';
import { useManager } from 'coco-cashu-react';
import {
  getOfflineFiatSendSuggestions,
  getOfflineSendSuggestions,
  getSatRangeForDisplayedFiatMinorUnit,
} from '@/features/send/lib/offlineSendSuggestions';
import type { InputMode, OfflineSendabilityState, SendMode, SendModeDebugInfo } from './types';
import {
  formatAmountList,
  formatFiatMinorUnit,
  formatSatsAmount,
  orderCandidatesByCloseness,
} from './utils';

interface SendRouteAnalysisInput {
  isSendTokenFlow: boolean;
  selectedMint: string | undefined;
  amount: number;
  mintBalance: number;
  inputMode: InputMode;
  fiatMinorUnitAmount: number | null;
  btcPrice: number | null;
  currencySymbol: string;
  offlineSendability: OfflineSendabilityState | null;
}

interface SendRouteAnalysisResult {
  sendMode: SendMode | null;
  debugInfo: SendModeDebugInfo | null;
}

export function useSendRouteAnalysis(input: SendRouteAnalysisInput): SendRouteAnalysisResult {
  const {
    isSendTokenFlow,
    selectedMint,
    amount,
    mintBalance,
    inputMode,
    fiatMinorUnitAmount,
    btcPrice,
    currencySymbol,
    offlineSendability,
  } = input;

  const manager = useManager();
  const requestIdRef = useRef(0);
  const [sendMode, setSendMode] = useState<SendMode | null>(null);
  const [debugInfo, setDebugInfo] = useState<SendModeDebugInfo | null>(null);

  useEffect(() => {
    if (!isSendTokenFlow) {
      setSendMode(null);
      setDebugInfo(null);
      return;
    }

    if (!selectedMint || !Number.isFinite(amount) || amount <= 0) {
      setSendMode(null);
      setDebugInfo({
        title: 'Checking route',
        message: 'Enter an amount to analyze whether this send can be completed offline.',
      });
      return;
    }

    if (amount > mintBalance) {
      setSendMode(null);
      setDebugInfo({
        title: 'Insufficient balance',
        message: `This send needs ${formatSatsAmount(amount)} but the selected mint only has ${formatSatsAmount(mintBalance)} available.`,
      });
      return;
    }

    if (!offlineSendability) {
      setSendMode(null);
      setDebugInfo({
        title: 'Checking route',
        message:
          'The wallet is building the offline exact-amount index from your ready proofs for the selected mint.',
      });
      return;
    }

    if (offlineSendability.totalReadyBalance < amount) {
      setSendMode(null);
      setDebugInfo({
        title: 'Not enough ready proofs',
        message: `Your ready proofs sum to ${formatSatsAmount(offlineSendability.totalReadyBalance)}, which is below the requested ${formatSatsAmount(amount)}.`,
      });
      return;
    }

    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setSendMode(null);

    void (async () => {
      if (inputMode === 'fiat' && fiatMinorUnitAmount != null && btcPrice) {
        const result = await analyzeFiatRoute({
          amount,
          fiatMinorUnitAmount,
          btcPrice,
          currencySymbol,
          offlineSendability,
          selectedMint,
          proofService: manager.proofService,
        });

        if (cancelled || requestIdRef.current !== requestId) return;
        setSendMode(result.sendMode);
        setDebugInfo(result.debugInfo);
        return;
      }

      const result = await analyzeSatsRoute({
        amount,
        offlineSendability,
        selectedMint,
        proofService: manager.proofService,
      });

      if (cancelled || requestIdRef.current !== requestId) return;
      setSendMode(result.sendMode);
      setDebugInfo(result.debugInfo);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    amount,
    btcPrice,
    currencySymbol,
    fiatMinorUnitAmount,
    inputMode,
    isSendTokenFlow,
    manager.proofService,
    mintBalance,
    offlineSendability,
    selectedMint,
  ]);

  return { sendMode, debugInfo };
}

// --- Private analysis helpers ---

interface FiatRouteInput {
  amount: number;
  fiatMinorUnitAmount: number;
  btcPrice: number;
  currencySymbol: string;
  offlineSendability: OfflineSendabilityState;
  selectedMint: string;
  proofService: any;
}

async function analyzeFiatRoute(input: FiatRouteInput): Promise<{
  sendMode: SendMode;
  debugInfo: SendModeDebugInfo;
}> {
  const {
    amount,
    fiatMinorUnitAmount,
    btcPrice,
    currencySymbol,
    offlineSendability,
    selectedMint,
    proofService,
  } = input;

  const fiatLabel = formatFiatMinorUnit(fiatMinorUnitAmount, currencySymbol);
  const sameDisplayRange = getSatRangeForDisplayedFiatMinorUnit(fiatMinorUnitAmount, btcPrice);

  const sameDisplayCandidates = sameDisplayRange
    ? offlineSendability.reachableSums.filter(
        (c) => c >= sameDisplayRange.minSat && c <= sameDisplayRange.maxSat
      )
    : [];

  const sameDisplaySearchOrder = orderCandidatesByCloseness(sameDisplayCandidates, amount);

  const fiatSuggestions = await getOfflineFiatSendSuggestions(
    proofService,
    selectedMint,
    amount,
    fiatMinorUnitAmount,
    btcPrice
  );

  const lines: string[] = [
    `${fiatLabel} currently converts to about ${formatSatsAmount(amount)}.`,
  ];

  if (sameDisplayRange) {
    lines.push(
      `${fiatLabel} stays the same for any amount from ${formatSatsAmount(sameDisplayRange.minSat)} to ${formatSatsAmount(sameDisplayRange.maxSat)} because those sats all round to the same fiat display.`
    );
  }

  if (sameDisplayCandidates.length > 0) {
    lines.push(
      `Exact offline amounts already constructible from your ready proofs in that same-price window: ${formatAmountList(sameDisplayCandidates, formatSatsAmount)}.`
    );
    lines.push(
      `Nearest-first search inside that window: ${formatAmountList(sameDisplaySearchOrder, formatSatsAmount)}.`
    );
  } else {
    lines.push(
      'There are no exact offline amounts from your current proofs inside that same-price window.'
    );
  }

  if (offlineSendability.reachableAmounts.has(amount)) {
    lines.push(
      `${formatSatsAmount(amount)} is already exact, so it can be sent offline as entered.`
    );
  } else {
    lines.push(
      `${formatSatsAmount(amount)} can't be sent offline exactly, so the wallet looks for the nearest exact amount that still displays as ${fiatLabel}.`
    );
  }

  if (fiatSuggestions.autoSelectAmount != null) {
    lines.push(
      `First match found: ${formatSatsAmount(fiatSuggestions.autoSelectAmount)}. It still displays as ${fiatLabel}, so the header shows offline-spendable.`
    );
    return {
      sendMode: 'offline',
      debugInfo: { title: 'Offline sendable', message: lines.join('\n\n') },
    };
  }

  lines.push(`No exact offline amount was found that still displays as ${fiatLabel}.`);

  // Search nearby fiat amounts for fallback options
  for (let step = 1; step <= 5; step++) {
    const lower = fiatMinorUnitAmount - step;
    const upper = fiatMinorUnitAmount + step;

    if (lower >= 0) {
      const range = getSatRangeForDisplayedFiatMinorUnit(lower, btcPrice);
      if (range) {
        const candidates = offlineSendability.reachableSums.filter(
          (c) => c >= range.minSat && c <= range.maxSat
        );
        lines.push(
          `${formatFiatMinorUnit(lower, currencySymbol)} would search ${formatSatsAmount(range.minSat)} to ${formatSatsAmount(range.maxSat)}. Exact offline amounts there: ${formatAmountList(candidates, formatSatsAmount)}.`
        );
      }
    }

    const upperRange = getSatRangeForDisplayedFiatMinorUnit(upper, btcPrice);
    if (upperRange) {
      const candidates = offlineSendability.reachableSums.filter(
        (c) => c >= upperRange.minSat && c <= upperRange.maxSat
      );
      lines.push(
        `${formatFiatMinorUnit(upper, currencySymbol)} would search ${formatSatsAmount(upperRange.minSat)} to ${formatSatsAmount(upperRange.maxSat)}. Exact offline amounts there: ${formatAmountList(candidates, formatSatsAmount)}.`
      );
    }

    if (
      (fiatSuggestions.roundDownOption?.displayMinorUnit === lower) ||
      (fiatSuggestions.roundUpOption?.displayMinorUnit === upper)
    ) {
      break;
    }
  }

  if (fiatSuggestions.roundDownOption || fiatSuggestions.roundUpOption) {
    const options = [
      fiatSuggestions.roundDownOption
        ? `${formatFiatMinorUnit(fiatSuggestions.roundDownOption.displayMinorUnit, currencySymbol)} -> ${formatSatsAmount(fiatSuggestions.roundDownOption.amount)}`
        : null,
      fiatSuggestions.roundUpOption
        ? `${formatFiatMinorUnit(fiatSuggestions.roundUpOption.displayMinorUnit, currencySymbol)} -> ${formatSatsAmount(fiatSuggestions.roundUpOption.amount)}`
        : null,
    ].filter(Boolean);

    lines.push(
      `That is why the header shows rounding required. The first wider-range exact options are ${options.join(' or ')}.`
    );
  } else {
    lines.push(
      'No exact offline fallback was found in the current debug search range, so this send would need an online swap.'
    );
  }

  return {
    sendMode: 'online',
    debugInfo: { title: 'Offline round required', message: lines.join('\n\n') },
  };
}

interface SatsRouteInput {
  amount: number;
  offlineSendability: OfflineSendabilityState;
  selectedMint: string;
  proofService: any;
}

async function analyzeSatsRoute(input: SatsRouteInput): Promise<{
  sendMode: SendMode;
  debugInfo: SendModeDebugInfo;
}> {
  const { amount, offlineSendability, selectedMint, proofService } = input;

  const suggestions = await getOfflineSendSuggestions(proofService, selectedMint, amount);

  const nearbyAmounts = orderCandidatesByCloseness(
    offlineSendability.reachableSums.filter(
      (c) => Math.abs(c - amount) <= Math.max(25, Math.ceil(amount * 0.1))
    ),
    amount
  );

  const lines: string[] = [
    `Requested amount: ${formatSatsAmount(amount)}.`,
    `Exact offline amounts already constructible near this value: ${formatAmountList(nearbyAmounts, formatSatsAmount)}.`,
  ];

  if (suggestions.isRequestedAmountSendableOffline) {
    lines.push(`${formatSatsAmount(amount)} is exact, so it can be sent offline as entered.`);
    return {
      sendMode: 'offline',
      debugInfo: { title: 'Offline sendable', message: lines.join('\n\n') },
    };
  }

  lines.push(
    `${formatSatsAmount(amount)} can't be sent offline exactly. The closest validated exact amounts are ${
      suggestions.roundDownAmount ? formatSatsAmount(suggestions.roundDownAmount) : 'no lower match'
    } and ${
      suggestions.roundUpAmount ? formatSatsAmount(suggestions.roundUpAmount) : 'no higher match'
    }.`
  );

  return {
    sendMode: 'online',
    debugInfo: { title: 'Offline round required', message: lines.join('\n\n') },
  };
}
