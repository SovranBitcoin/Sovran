// ---------------------------------------------------------------------------
// useAnnotatedOptions — memoized option annotation
// ---------------------------------------------------------------------------

import { useMemo } from 'react';

import { annotateOptions } from '../annotate';
import type { PaymentOption, WalletContext, Detectors, AnnotatedOption } from '../types';

/**
 * Memoized annotation of payment options with wallet context.
 * Re-annotates when options, context, or detectors change.
 */
export function useAnnotatedOptions(
  options: PaymentOption[],
  ctx: WalletContext,
  detectors: Detectors
): AnnotatedOption[] {
  return useMemo(() => annotateOptions(options, ctx, detectors), [options, ctx, detectors]);
}
