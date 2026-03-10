import { assign } from 'xstate';

import type {
  SendMachineContext,
  SendMachineError,
  CheckBalanceOutput,
  CheckConnectivityOutput,
  ExecuteSendOutput,
  OfflineResolutionResult,
} from './sendMachine.types';

// ---------------------------------------------------------------------------
// Amount & denomination
// ---------------------------------------------------------------------------

export const assignAmount = assign({
  amountSat: (_, params: { amountSat: number }) => params.amountSat,
  fiatAmount: (_, params: { fiatAmount?: number | null }) => params.fiatAmount ?? null,
});

export const assignDenomination = assign({
  denomination: (_, params: { denomination: 'sat' | 'fiat' }) => params.denomination,
});

export const assignMint = assign({
  mintUrl: (_, params: { mintUrl: string }) => params.mintUrl,
});

// ---------------------------------------------------------------------------
// Balance check result
// ---------------------------------------------------------------------------

export const assignBalance = assign({
  mintBalance: ({ event }: { event: { output?: CheckBalanceOutput } }) =>
    (event as { output: CheckBalanceOutput }).output.balance,
});

// ---------------------------------------------------------------------------
// Connectivity check result
// ---------------------------------------------------------------------------

export const assignConnectivity = assign({
  isOffline: ({ event }: { event: { output?: CheckConnectivityOutput } }) =>
    !(event as { output: CheckConnectivityOutput }).output.isOnline,
});

// ---------------------------------------------------------------------------
// Send result
// ---------------------------------------------------------------------------

export const assignSendResult = assign({
  token: ({ event }: { event: { output?: ExecuteSendOutput } }) =>
    (event as { output: ExecuteSendOutput }).output.token,
  operationId: ({ event }: { event: { output?: ExecuteSendOutput } }) =>
    (event as { output: ExecuteSendOutput }).output.operationId,
  historyEntryJson: ({ event }: { event: { output?: ExecuteSendOutput } }) =>
    (event as { output: ExecuteSendOutput }).output.historyEntryJson,
});

// ---------------------------------------------------------------------------
// Offline resolution
// ---------------------------------------------------------------------------

export const assignOfflineResolved = assign({
  resolvedAmount: ({ event }: { event: { output?: OfflineResolutionResult } }) => {
    const output = (event as { output: OfflineResolutionResult }).output;
    if (output.type === 'exact' || output.type === 'fiat-range') {
      return output.amount;
    }
    return null;
  },
  offlineSuggestions: ({ event }: { event: { output?: OfflineResolutionResult } }) => {
    const output = (event as { output: OfflineResolutionResult }).output;
    if (output.type === 'impossible') {
      return output.suggestions;
    }
    return null;
  },
  fiatOfflineSuggestions: ({ event }: { event: { output?: OfflineResolutionResult } }) => {
    const output = (event as { output: OfflineResolutionResult }).output;
    if (output.type === 'impossible') {
      return output.fiatSuggestions;
    }
    return null;
  },
});

export const assignRoundUp = assign({
  resolvedAmount: ({ context }: { context: SendMachineContext }) => {
    if (context.fiatOfflineSuggestions?.roundUpOption) {
      return context.fiatOfflineSuggestions.roundUpOption.amount;
    }
    return context.offlineSuggestions?.roundUpAmount ?? null;
  },
});

export const assignRoundDown = assign({
  resolvedAmount: ({ context }: { context: SendMachineContext }) => {
    if (context.fiatOfflineSuggestions?.roundDownOption) {
      return context.fiatOfflineSuggestions.roundDownOption.amount;
    }
    return context.offlineSuggestions?.roundDownAmount ?? null;
  },
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

export const assignSendError = assign({
  error: ({ event }: { event: { error?: unknown } }): SendMachineError => {
    const err = (event as { error: unknown }).error;
    return {
      code: 'SEND_FAILED',
      message: err instanceof Error ? err.message : String(err),
      recoverable: true,
    };
  },
});

export const clearError = assign({
  error: (): null => null,
});

export const clearSendResult = assign({
  token: (): null => null,
  operationId: (): null => null,
  historyEntryJson: (): null => null,
  resolvedAmount: (): null => null,
  offlineSuggestions: (): null => null,
  fiatOfflineSuggestions: (): null => null,
});
