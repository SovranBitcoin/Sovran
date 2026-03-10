import { setup, assign } from 'xstate';

import {
  checkBalanceActor,
  checkConnectivityActor,
  executeSendActor,
  resolveOfflineActor,
} from './actors';
import {
  assignSendResult,
  assignOfflineResolved,
  assignRoundUp,
  assignRoundDown,
  assignSendError,
  clearError,
  clearSendResult,
} from './actions';

import type {
  SendMachineContext,
  SendMachineEvent,
  SendMachineInput,
  SendMachineError,
  CheckBalanceOutput,
  CheckConnectivityOutput,
  ExecuteSendOutput,
  OfflineResolutionResult,
} from './sendMachine.types';

export const sendMachine = setup({
  types: {} as {
    context: SendMachineContext;
    events: SendMachineEvent;
    input: SendMachineInput;
  },
  actors: {
    checkBalance: checkBalanceActor,
    checkConnectivity: checkConnectivityActor,
    executeSend: executeSendActor,
    resolveOffline: resolveOfflineActor,
  },
  guards: {
    canProceed: ({ context }) =>
      Number.isFinite(context.amountSat) && context.amountSat > 0 && context.mintUrl !== null,
  },
  actions: {
    assignSendResult: assignSendResult as any,
    assignOfflineResolved: assignOfflineResolved as any,
    assignRoundUp: assignRoundUp as any,
    assignRoundDown: assignRoundDown as any,
    assignSendError: assignSendError as any,
    clearError: clearError as any,
    clearSendResult: clearSendResult as any,
  },
}).createMachine({
  id: 'send',
  initial: 'editingAmount',
  context: ({ input }): SendMachineContext => ({
    denomination: input?.denomination ?? 'sat',
    amountSat: input?.amountSat ?? 0,
    fiatAmount: input?.fiatAmount ?? null,
    fiatSatRange: null,
    mintUrl: input?.mintUrl ?? null,
    mintBalance: 0,
    isOffline: false,
    offlineSuggestions: null,
    fiatOfflineSuggestions: null,
    resolvedAmount: null,
    token: null,
    operationId: null,
    historyEntryJson: null,
    error: null,
  }),

  states: {
    // -----------------------------------------------------------------
    // User enters amount, denomination, and mint
    // -----------------------------------------------------------------
    editingAmount: {
      on: {
        SET_AMOUNT: {
          actions: assign({
            amountSat: ({ event }) => event.amountSat,
            fiatAmount: ({ event }) => event.fiatAmount ?? null,
          }),
        },
        SET_DENOMINATION: {
          actions: assign({
            denomination: ({ event }) => event.denomination,
          }),
        },
        SET_MINT: {
          actions: assign({
            mintUrl: ({ event }) => event.mintUrl,
          }),
        },
        NEXT: {
          guard: 'canProceed',
          target: 'validatingBalance',
          actions: ['clearError', 'clearSendResult'],
        },
      },
    },

    // -----------------------------------------------------------------
    // Check if selected mint has sufficient balance
    // -----------------------------------------------------------------
    validatingBalance: {
      invoke: {
        src: 'checkBalance',
        input: ({ context }) => ({ mintUrl: context.mintUrl! }),
        onDone: [
          {
            guard: ({ context, event }) =>
              (event as unknown as { output: CheckBalanceOutput }).output.balance >=
              context.amountSat,
            target: 'checkingConnectivity',
            actions: assign({
              mintBalance: ({ event }) =>
                (event as unknown as { output: CheckBalanceOutput }).output.balance,
            }),
          },
          {
            target: 'mintSelect',
            actions: assign({
              mintBalance: ({ event }) =>
                (event as unknown as { output: CheckBalanceOutput }).output.balance,
            }),
          },
        ],
        onError: {
          target: 'failure',
          actions: assign({
            error: ({ event }): SendMachineError => ({
              code: 'BALANCE_CHECK_FAILED',
              message: event.error instanceof Error ? event.error.message : String(event.error),
              recoverable: true,
            }),
          }),
        },
      },
    },

    // -----------------------------------------------------------------
    // User selects a different mint
    // -----------------------------------------------------------------
    mintSelect: {
      on: {
        MINT_SELECTED: {
          target: 'validatingBalance',
          actions: assign({
            mintUrl: ({ event }) => event.mintUrl,
          }),
        },
        CANCEL: { target: 'editingAmount' },
      },
    },

    // -----------------------------------------------------------------
    // Check network connectivity
    // -----------------------------------------------------------------
    checkingConnectivity: {
      invoke: {
        src: 'checkConnectivity',
        onDone: [
          {
            guard: ({ event }) =>
              (event as unknown as { output: CheckConnectivityOutput }).output.isOnline,
            target: 'onlineSend',
            actions: assign({ isOffline: () => false }),
          },
          {
            target: 'offlineResolution',
            actions: assign({ isOffline: () => true }),
          },
        ],
        onError: {
          target: 'offlineResolution',
          actions: assign({ isOffline: () => true }),
        },
      },
    },

    // -----------------------------------------------------------------
    // Attempt online ecash send — fallback to offline on failure
    // -----------------------------------------------------------------
    onlineSend: {
      invoke: {
        src: 'executeSend',
        input: ({ context }) => ({
          mintUrl: context.mintUrl!,
          amount: context.amountSat,
        }),
        onDone: {
          target: 'success',
          actions: 'assignSendResult',
        },
        onError: {
          target: 'offlineResolution',
        },
      },
    },

    // -----------------------------------------------------------------
    // Resolve coins for offline send
    // -----------------------------------------------------------------
    offlineResolution: {
      invoke: {
        src: 'resolveOffline',
        input: ({ context }) => ({
          mintUrl: context.mintUrl!,
          amountSat: context.amountSat,
          denomination: context.denomination,
          fiatAmount: context.fiatAmount,
        }),
        onDone: [
          {
            guard: ({ event }) => {
              const result = (event as unknown as { output: OfflineResolutionResult }).output;
              return result.type === 'exact' || result.type === 'fiat-range';
            },
            target: 'sendingToken',
            actions: 'assignOfflineResolved',
          },
          {
            target: 'adjustmentPrompt',
            actions: 'assignOfflineResolved',
          },
        ],
        onError: {
          target: 'failure',
          actions: 'assignSendError',
        },
      },
    },

    // -----------------------------------------------------------------
    // User picks round up / round down / cancel
    // -----------------------------------------------------------------
    adjustmentPrompt: {
      on: {
        ROUND_UP: {
          target: 'sendingToken',
          actions: 'assignRoundUp',
        },
        ROUND_DOWN: {
          target: 'sendingToken',
          actions: 'assignRoundDown',
        },
        CANCEL: { target: 'editingAmount' },
      },
    },

    // -----------------------------------------------------------------
    // Execute ecash send with offline-resolved amount
    // -----------------------------------------------------------------
    sendingToken: {
      invoke: {
        src: 'executeSend',
        input: ({ context }) => ({
          mintUrl: context.mintUrl!,
          amount: context.resolvedAmount ?? context.amountSat,
        }),
        onDone: {
          target: 'success',
          actions: 'assignSendResult',
        },
        onError: {
          target: 'failure',
          actions: 'assignSendError',
        },
      },
    },

    // -----------------------------------------------------------------
    // Terminal states
    // -----------------------------------------------------------------
    success: {
      type: 'final',
    },

    failure: {
      on: {
        RETRY: {
          target: 'validatingBalance',
          actions: 'clearError',
        },
        CANCEL: {
          target: 'editingAmount',
          actions: ['clearError', 'clearSendResult'],
        },
      },
    },
  },
});
