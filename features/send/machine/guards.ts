import type { SendMachineContext, OfflineResolutionResult } from './sendMachine.types';

/**
 * Pure guard functions for the send state machine.
 * Operate only on context — no controller or side-effect calls.
 */

export const isAmountValid = ({ context }: { context: SendMachineContext }): boolean =>
  Number.isFinite(context.amountSat) && context.amountSat > 0;

export const isMintSelected = ({ context }: { context: SendMachineContext }): boolean =>
  context.mintUrl !== null;

export const isBalanceSufficient = ({ context }: { context: SendMachineContext }): boolean =>
  context.mintBalance >= context.amountSat;

export const isOffline = ({ context }: { context: SendMachineContext }): boolean =>
  context.isOffline;

export const hasExactMatch = (_: unknown, params: { result: OfflineResolutionResult }): boolean =>
  params.result.type === 'exact';

export const hasFiatRangeMatch = (
  _: unknown,
  params: { result: OfflineResolutionResult }
): boolean => params.result.type === 'fiat-range';

export const isImpossible = (_: unknown, params: { result: OfflineResolutionResult }): boolean =>
  params.result.type === 'impossible';
