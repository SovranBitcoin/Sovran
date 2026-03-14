import { useCallback, useMemo } from 'react';

import { parsePaymentInput } from '../parse';
import { resolveIntent } from '../intent';
import { validateIntent } from '../guards';
import type {
  Detectors,
  WalletContext,
  ParsedPaymentInput,
  ResolvedIntent,
  GuardResult,
} from '../types';

export interface PaymentInputResult {
  parsed: ParsedPaymentInput;
  intent: ResolvedIntent;
  guards: GuardResult[];
}

export interface UsePaymentInputConfig {
  detectors: Detectors;
  walletContext: WalletContext;
}

/**
 * Stateless parse + intent + guard hook. Does not manage flow state --
 * use alongside a PaymentMachine for full flow orchestration.
 */
export function usePaymentInput(config: UsePaymentInputConfig) {
  const { detectors, walletContext } = config;

  const processInput = useCallback(
    (rawInput: string): PaymentInputResult => {
      const parsed = parsePaymentInput(rawInput, detectors);
      const intent = resolveIntent(parsed, detectors, walletContext);
      const guards = validateIntent(intent, walletContext, detectors);
      return { parsed, intent, guards };
    },
    [detectors, walletContext]
  );

  const resolveSelectedOption = useCallback(
    (parsed: ParsedPaymentInput, selectedOptionIndex: number): PaymentInputResult => {
      const option = parsed.options[selectedOptionIndex];
      if (!option) {
        const intent: ResolvedIntent = { type: 'ignore', reason: 'Invalid option index' };
        return { parsed, intent, guards: [] };
      }

      const singleParsed: ParsedPaymentInput = { ...parsed, options: [option] };
      const intent = resolveIntent(singleParsed, detectors, walletContext);
      const guards = validateIntent(intent, walletContext, detectors);
      return { parsed: singleParsed, intent, guards };
    },
    [detectors, walletContext]
  );

  return useMemo(
    () => ({ processInput, resolveSelectedOption }),
    [processInput, resolveSelectedOption]
  );
}
