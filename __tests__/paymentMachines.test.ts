/**
 * Unified sendMachine + mintQuoteMachine unit tests.
 *
 * These tests exercise machine definitions in isolation by providing
 * all actors, guards, and actions via inline machines. This avoids importing
 * modules that require native/ESM transforms (coco, cashu-ts, NFC, etc.).
 */

import { assign, createActor, createMachine, fromPromise, waitFor } from 'xstate';

import type { MintQuoteContext, MintQuoteInput } from '@/shared/lib/payment-machines/types';
import type {
  SendMachineContext,
  SendMachineEvent,
  SendMachineInput,
  ParsedPaymentString,
  ParsedPaymentType,
} from '@/shared/lib/payment-machines/sendMachine.types';
import type { PaymentError } from '@/shared/lib/payment-machines/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopAction = () => {};

const mockSendResult = {
  token: 'cashuBtest-token',
  historyEntry: {
    id: 'entry-1',
    type: 'send' as const,
    amount: 100,
    operationId: 'op-1',
    state: 'pending',
    mintUrl: 'https://mint.example',
  },
  operationId: 'op-1',
};

const mockMeltQuoteResult = {
  quote: { quote: 'q-1', amount: 100, fee_reserve: 2, state: 'UNPAID' },
  historyEntry: {
    id: 'entry-2',
    type: 'melt' as const,
    quoteId: 'q-1',
    amount: 100,
    state: 'UNPAID',
    mintUrl: 'https://mint.example',
  },
  operationId: 'op-2',
};

const mockMintQuoteResult = {
  mintQuote: { quote: 'mq-1', request: 'lnbc...', state: 'UNPAID' },
  historyEntry: {
    id: 'entry-3',
    type: 'mint' as const,
    quoteId: 'mq-1',
    amount: 100,
    state: 'UNPAID',
    mintUrl: 'https://mint.example',
    paymentRequest: 'lnbc...',
  },
};

function successActor<T>(value: T) {
  return fromPromise(async () => value);
}

function failActor(message: string) {
  return fromPromise(async () => {
    throw new Error(message);
  });
}

function makeError(code: string, error: unknown, recoverable = false): PaymentError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    recoverable,
  };
}

// ---------------------------------------------------------------------------
// Inline sendMachine (mirrors real unified machine)
// ---------------------------------------------------------------------------

function isParsedType(type: ParsedPaymentType) {
  return ({ context }: { context: SendMachineContext }) =>
    context.parsedResult?.type === type;
}

function makeSendMachine(overrides: {
  parsePaymentString?: any;
  sendEcash?: any;
  rollbackSend?: any;
  captureLocation?: any;
  getOfflineSuggestions?: any;
  checkFiatOfflineOptimization?: any;
  resolveLnUrl?: any;
  prepareMeltQuote?: any;
  executeMeltQuote?: any;
  rollbackMelt?: any;
  selectBestMint?: any;
  requestCameraPermission?: any;
  nfcReadRequest?: any;
  nfcWriteToken?: any;
}) {
  return createMachine(
    {
      id: 'send',
      types: {} as {
        context: SendMachineContext;
        events: SendMachineEvent;
        input: SendMachineInput;
      },
      context: ({ input }): SendMachineContext => ({
        source: input.source ?? 'direct',
        rawData: null,
        parsedResult: null,
        cameraPermission: 'unknown',
        urProgress: 0,
        mintUrl: input.mintUrl ?? null,
        amount: input.amount ?? 0,
        mintBalance: input.mintBalance ?? 0,
        isOffline: input.isOffline ?? false,
        manager: input.manager ?? null,
        error: null,
        sendBranch: input.sendBranch ?? null,
        token: null,
        historyEntry: null,
        operationId: null,
        offlineSendability: input.offlineSendability ?? null,
        offlineSuggestions: null,
        fiatOfflineAmount: null,
        unit: input.unit ?? 'sat',
        scanRaw: input.scanRaw ?? null,
        btcPrice: input.btcPrice ?? null,
        lnUrlOrAddress: input.lnUrlOrAddress ?? null,
        invoice: input.invoice ?? null,
        quote: null,
        meltHistoryEntry: null,
        meltOperationId: null,
        maxAmountSats: input.maxAmountSats,
        allowedMints: [],
        selectedMint: null,
        paymentRequest: null,
        isPaymentRequest: false,
        encodedPaymentRequest: input.encodedPaymentRequest ?? null,
        receiveBranch: null,
        tokenString: null,
        isAlreadySpent: false,
        receiveHistoryEntry: null,
      }),
      initial: 'idle',
      states: {
        idle: {
          on: {
            SCAN: {
              target: 'input',
              actions: assign({
                rawData: ({ event }) => event.data,
                source: ({ event }) => event.source,
                parsedResult: null,
              }),
            },
            START_NFC: [
              {
                guard: ({ context }) => !context.manager,
                target: 'error',
                actions: assign({
                  error: (): PaymentError => ({
                    code: 'WALLET_NOT_READY',
                    message: 'Wallet not ready',
                    recoverable: false,
                  }),
                }),
              },
              {
                target: 'input',
                actions: assign({
                  source: 'nfc' as const,
                  sendBranch: 'nfc' as const,
                  maxAmountSats: ({ event }) => event.maxAmountSats,
                }),
              },
            ],
            SET_AMOUNT: {
              actions: assign({ amount: ({ event }) => event.amount }),
            },
            SET_MINT: {
              actions: assign({
                mintUrl: ({ event }) => event.mintUrl,
                mintBalance: ({ event }) => event.mintBalance,
              }),
            },
            SET_MANAGER: {
              actions: assign({ manager: ({ event }) => event.manager }),
            },
            NEXT: [
              { guard: ({ context }) => !context.manager, target: 'idle' },
              { guard: ({ context }) => !context.mintUrl, target: 'noMint' },
              { guard: ({ context }) => !(context.amount > 0), target: 'idle' },
              { guard: ({ context }) => context.sendBranch === 'melt', target: 'meltSend' },
              {
                guard: ({ context }) => context.mintBalance < context.amount,
                target: 'insufficientBalance',
              },
              {
                guard: ({ context }) => context.isOffline === true,
                target: 'setup',
                actions: assign({ sendBranch: 'ecash' as const }),
              },
              {
                guard: ({ context }) =>
                  context.unit !== 'sat' &&
                  !!context.btcPrice &&
                  !!context.offlineSendability &&
                  context.offlineSendability.totalReadyBalance > 0,
                target: 'setup',
                actions: assign({ sendBranch: 'ecash' as const }),
              },
              {
                target: 'ecashSend',
                actions: assign({ sendBranch: 'ecash' as const }),
              },
            ],
          },
        },

        noMint: { type: 'final' as const, entry: 'hapticError' },
        insufficientBalance: { type: 'final' as const, entry: 'hapticError' },

        // INPUT PHASE
        input: {
          initial: 'deciding',
          states: {
            deciding: {
              always: [
                { guard: ({ context }) => context.source === 'nfc', target: 'readingNfc' },
                {
                  guard: ({ context }) =>
                    context.source === 'qr' && context.cameraPermission !== 'granted',
                  target: 'checkingPermission',
                },
                { target: 'parsing' },
              ],
            },
            checkingPermission: {
              invoke: {
                src: 'requestCameraPermission',
                onDone: [
                  {
                    guard: ({ event }) => (event as any).output.status === 'granted',
                    target: 'parsing',
                    actions: assign({ cameraPermission: 'granted' as const }),
                  },
                  {
                    target: '#send.permissionDenied',
                    actions: assign({ cameraPermission: 'denied' as const }),
                  },
                ],
                onError: {
                  target: 'parsing',
                  actions: assign({ cameraPermission: 'granted' as const }),
                },
              },
            },
            parsing: {
              invoke: {
                src: 'parsePaymentString',
                input: ({ context }) => ({ data: context.rawData! }),
                onDone: {
                  target: 'routing',
                  actions: assign({ parsedResult: ({ event }) => (event as any).output }),
                },
                onError: { target: '#send.idle' },
              },
            },
            routing: {
              always: [
                { guard: isParsedType('ur'), target: '#send.routeUR' },
                { guard: isParsedType('ecash'), target: '#send.routeEcashReceive' },
                { guard: isParsedType('paymentRequest'), target: '#send.routePaymentRequest' },
                { guard: isParsedType('lightningInvoice'), target: '#send.routeLightning' },
                { guard: isParsedType('lightningAddress'), target: '#send.routeLightning' },
                { guard: isParsedType('mintUrl'), target: '#send.routeMintUrl' },
                { guard: isParsedType('npub'), target: '#send.routeNpub' },
                { target: '#send.idle' },
              ],
            },
            readingNfc: {
              invoke: {
                src: 'nfcReadRequest',
                input: ({ context }) => ({ maxAmountSats: context.maxAmountSats }),
                onDone: {
                  target: 'decodingNfcRequest',
                  actions: assign(({ event }) => ({
                    rawData: (event as any).output.rawData,
                    paymentRequest: (event as any).output.paymentRequest,
                    amount: (event as any).output.amount,
                    allowedMints: (event as any).output.allowedMints,
                  })),
                },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }): PaymentError => ({
                      code: 'NFC_READ_FAILED',
                      message: (event as any).error?.message ?? 'NFC read failed',
                      recoverable: true,
                    }),
                  }),
                },
              },
            },
            decodingNfcRequest: {
              always: [
                // Simplified: in real machine this checks isLightningInvoice
                { target: '#send.setup' },
              ],
            },
          },
        },

        // ROUTING TERMINALS
        routeUR: {
          on: {
            UR_PROGRESS: { actions: assign({ urProgress: ({ event }) => event.progress }) },
            UR_COMPLETE: {
              target: 'routeEcashReceive',
              actions: assign({
                parsedResult: ({ event }): ParsedPaymentString => ({
                  type: 'ecash',
                  data: event.data,
                }),
              }),
            },
            RESET: { target: 'idle' },
          },
        },
        routeEcashReceive: { type: 'final' as const },
        routePaymentRequest: { type: 'final' as const },
        routeLightning: { type: 'final' as const },
        routeMintUrl: { type: 'final' as const },
        routeNpub: { type: 'final' as const },
        permissionDenied: { type: 'final' as const },
        lightningRedirect: { type: 'final' as const },

        // SETUP PHASE
        setup: {
          initial: 'deciding',
          states: {
            deciding: {
              always: [
                { guard: ({ context }) => context.sendBranch === 'nfc', target: 'selectingMint' },
                {
                  guard: ({ context }) =>
                    context.sendBranch === 'ecash' && context.isOffline === true,
                  target: 'checkingOffline',
                },
                {
                  guard: ({ context }) =>
                    context.sendBranch === 'ecash' &&
                    context.unit !== 'sat' &&
                    !!context.btcPrice &&
                    !!context.offlineSendability &&
                    context.offlineSendability.totalReadyBalance > 0,
                  target: 'checkingFiatOffline',
                },
                { guard: ({ context }) => context.sendBranch === 'ecash', target: '#send.ecashSend' },
                { guard: ({ context }) => context.sendBranch === 'melt', target: '#send.meltSend' },
                { target: '#send.ecashSend' },
              ],
            },
            selectingMint: {
              invoke: {
                src: 'selectBestMint',
                input: ({ context }) => ({
                  allowedMints: context.allowedMints.length > 0 ? context.allowedMints : undefined,
                  availableMints: {} as Record<string, number>,
                  amount: context.amount,
                  preferredMint: context.mintUrl ?? undefined,
                }),
                onDone: {
                  target: '#send.ecashSend',
                  actions: assign({
                    selectedMint: ({ event }) => (event as any).output.mintUrl,
                    mintUrl: ({ event }) => (event as any).output.mintUrl,
                  }),
                },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }): PaymentError => ({
                      code: 'MINT_SELECTION_FAILED',
                      message: (event as any).error?.message ?? 'Mint selection failed',
                      recoverable: false,
                    }),
                  }),
                },
              },
            },
            checkingOffline: {
              always: [
                {
                  guard: ({ context }) =>
                    !!context.offlineSendability &&
                    context.offlineSendability.reachableSums.includes(context.amount),
                  target: '#send.ecashSend',
                },
                { target: 'offlineSuggestions' },
              ],
            },
            offlineSuggestions: {
              invoke: {
                src: 'getOfflineSuggestions',
                input: ({ context }) => ({
                  proofService: (context.manager as any)?.proofService,
                  mintUrl: context.mintUrl!,
                  amount: context.amount,
                }),
                onDone: [
                  {
                    guard: ({ event }) =>
                      (event as any).output?.isRequestedAmountSendableOffline === true,
                    target: '#send.ecashSend',
                  },
                  {
                    actions: assign({ offlineSuggestions: ({ event }) => (event as any).output }),
                  },
                ],
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }) => makeError('OFFLINE_SUGGESTIONS_FAILED', (event as any).error),
                  }),
                },
              },
              on: {
                SELECT_AMOUNT: {
                  target: '#send.ecashSend',
                  actions: assign({ amount: ({ event }) => event.amount }),
                },
                CANCEL: { target: '#send.cancelled' },
              },
            },
            checkingFiatOffline: {
              invoke: {
                src: 'checkFiatOfflineOptimization',
                input: ({ context }) => ({
                  proofService: (context.manager as any)?.proofService,
                  mintUrl: context.mintUrl!,
                  amount: context.amount,
                  btcPrice: context.btcPrice!,
                }),
                onDone: [
                  {
                    guard: ({ event }) => (event as any).output.fiatOfflineAmount != null,
                    target: '#send.ecashSend',
                    actions: assign({
                      fiatOfflineAmount: ({ event }) => (event as any).output.fiatOfflineAmount,
                      amount: ({ event }) => (event as any).output.fiatOfflineAmount ?? 0,
                    }),
                  },
                  { target: '#send.ecashSend' },
                ],
                onError: { target: '#send.ecashSend' },
              },
            },
          },
        },

        // ECASH SEND PHASE
        ecashSend: {
          initial: 'sending',
          states: {
            sending: {
              invoke: {
                src: 'sendEcash',
                input: ({ context }) => ({
                  mintUrl: (context.selectedMint || context.mintUrl)!,
                  amount: context.amount,
                  manager: context.manager!,
                }),
                onDone: {
                  target: 'capturingLocation',
                  actions: assign({
                    token: ({ event }) => (event as any).output.token,
                    historyEntry: ({ event }) => (event as any).output.historyEntry,
                    operationId: ({ event }) => (event as any).output.operationId,
                  }),
                },
                onError: {
                  target: 'sendFailed',
                  actions: assign({
                    error: ({ event }) => makeError('SEND_FAILED', (event as any).error),
                  }),
                },
              },
            },
            sendFailed: {
              always: [
                { guard: ({ context }) => !!context.operationId, target: 'rollingBack' },
                { target: 'offlineFallback' },
              ],
            },
            rollingBack: {
              invoke: {
                src: 'rollbackSend',
                input: ({ context }) => ({
                  operationId: context.operationId!,
                  manager: context.manager!,
                }),
                onDone: { target: 'offlineFallback' },
                onError: { target: 'offlineFallback' },
              },
            },
            offlineFallback: {
              always: [
                {
                  guard: ({ context }) =>
                    context.sendBranch !== 'nfc' &&
                    !!context.offlineSendability &&
                    context.offlineSendability.reachableSums.length > 0,
                  target: 'offlineFallbackSuggestions',
                },
                { target: '#send.error' },
              ],
            },
            offlineFallbackSuggestions: {
              invoke: {
                src: 'getOfflineSuggestions',
                input: ({ context }) => ({
                  proofService: (context.manager as any)?.proofService,
                  mintUrl: context.mintUrl!,
                  amount: context.amount,
                }),
                onDone: {
                  actions: assign({ offlineSuggestions: ({ event }) => (event as any).output }),
                },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }) => makeError('OFFLINE_FALLBACK_FAILED', (event as any).error),
                  }),
                },
              },
              on: {
                SELECT_AMOUNT: {
                  target: 'sending',
                  actions: assign({
                    amount: ({ event }) => event.amount,
                    error: null,
                    operationId: null,
                  }),
                },
                CANCEL: { target: '#send.error' },
              },
            },
            capturingLocation: {
              invoke: {
                src: 'captureLocation',
                input: ({ context }) => ({ transactionId: context.historyEntry!.id }),
                onDone: [
                  { guard: ({ context }) => context.sendBranch === 'nfc', target: '#send.nfcWrite' },
                  { target: '#send.success' },
                ],
                onError: [
                  { guard: ({ context }) => context.sendBranch === 'nfc', target: '#send.nfcWrite' },
                  { target: '#send.success' },
                ],
              },
            },
          },
        },

        // MELT SEND PHASE
        meltSend: {
          initial: 'validating',
          states: {
            validating: {
              always: [
                { guard: ({ context }) => !context.mintUrl, target: '#send.noMint' },
                {
                  guard: ({ context }) => !context.lnUrlOrAddress && !context.invoice,
                  target: '#send.error',
                  actions: assign({
                    error: (): PaymentError => ({
                      code: 'NO_ADDRESS',
                      message: 'No Lightning address or invoice provided',
                      recoverable: false,
                    }),
                  }),
                },
                {
                  guard: ({ context }) => !!context.lnUrlOrAddress && !context.invoice,
                  target: 'resolvingLnUrl',
                },
                { guard: ({ context }) => !!context.invoice, target: 'preparingQuote' },
              ],
            },
            resolvingLnUrl: {
              invoke: {
                src: 'resolveLnUrl',
                input: ({ context }) => ({
                  lnUrlOrAddress: context.lnUrlOrAddress!,
                  amount: context.amount,
                }),
                onDone: {
                  target: 'preparingQuote',
                  actions: assign({ invoice: ({ event }) => (event as any).output.invoice }),
                },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }) =>
                      makeError('LNURL_RESOLUTION_FAILED', (event as any).error, true),
                  }),
                },
              },
            },
            preparingQuote: {
              invoke: {
                src: 'prepareMeltQuote',
                input: ({ context }) => ({
                  mintUrl: context.mintUrl!,
                  invoice: context.invoice!,
                  manager: context.manager!,
                }),
                onDone: {
                  target: 'quoteReady',
                  actions: assign({
                    quote: ({ event }) => (event as any).output.quote,
                    meltHistoryEntry: ({ event }) => (event as any).output.historyEntry,
                    meltOperationId: ({ event }) => (event as any).output.operationId,
                  }),
                },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }) =>
                      makeError('QUOTE_PREPARATION_FAILED', (event as any).error),
                  }),
                },
              },
            },
            quoteReady: {
              on: {
                EXECUTE: { target: 'executing' },
                CHANGE_MINT: {
                  target: 'preparingQuote',
                  actions: assign({
                    mintUrl: ({ event }) => event.mintUrl,
                    mintBalance: ({ event }) => event.mintBalance,
                    quote: null,
                    meltHistoryEntry: null,
                    meltOperationId: null,
                  }),
                },
                CANCEL: { target: 'cancelling' },
              },
            },
            executing: {
              invoke: {
                src: 'executeMeltQuote',
                input: ({ context }) => ({
                  operationId: context.meltOperationId!,
                  manager: context.manager!,
                }),
                onDone: { target: 'capturingLocation' },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }) =>
                      makeError('MELT_EXECUTION_FAILED', (event as any).error),
                  }),
                },
              },
            },
            cancelling: {
              invoke: {
                src: 'rollbackMelt',
                input: ({ context }) => ({
                  operationId: context.meltOperationId!,
                  reason: 'User cancelled',
                  manager: context.manager!,
                }),
                onDone: { target: '#send.cancelled' },
                onError: {
                  target: '#send.error',
                  actions: assign({
                    error: ({ event }) => makeError('CANCEL_FAILED', (event as any).error),
                  }),
                },
              },
            },
            capturingLocation: {
              invoke: {
                src: 'captureLocation',
                input: ({ context }) => ({ transactionId: context.meltHistoryEntry!.id }),
                onDone: { target: '#send.success' },
                onError: { target: '#send.success' },
              },
            },
          },
        },

        // NFC WRITE PHASE
        nfcWrite: {
          initial: 'writingToken',
          states: {
            writingToken: {
              invoke: {
                src: 'nfcWriteToken',
                input: ({ context }) => ({ token: context.token! }),
                onDone: { target: 'waitingFinalization' },
                onError: {
                  target: 'writeError',
                  actions: assign({
                    error: (): PaymentError => ({
                      code: 'WRITE_FAILED',
                      message: 'NFC write failed',
                      recoverable: false,
                    }),
                  }),
                },
              },
            },
            writeError: {
              always: [
                { guard: ({ context }) => !!context.operationId, target: 'rollingBack' },
                { target: '#send.error' },
              ],
            },
            rollingBack: {
              invoke: {
                src: 'rollbackSend',
                input: ({ context }) => ({
                  operationId: context.operationId!,
                  manager: context.manager!,
                }),
                onDone: { target: '#send.error' },
                onError: { target: '#send.error' },
              },
            },
            waitingFinalization: {
              on: {
                FINALIZED: {
                  target: '#send.success',
                  actions: assign({ historyEntry: ({ event }) => event.historyEntry }),
                },
              },
            },
          },
        },

        // TERMINALS
        success: { type: 'final' as const, entry: ['hapticSuccess', 'linkTransaction'] },
        cancelled: { type: 'final' as const },
        error: { type: 'final' as const, entry: 'hapticError' },
      },
    },
    {
      actors: {
        parsePaymentString:
          overrides.parsePaymentString ??
          fromPromise(async ({ input }: { input: { data: string } }) => ({
            type: 'unknown',
            data: input.data,
          })),
        sendEcash: overrides.sendEcash ?? successActor(mockSendResult),
        rollbackSend: overrides.rollbackSend ?? successActor(undefined),
        captureLocation: overrides.captureLocation ?? successActor(true),
        getOfflineSuggestions:
          overrides.getOfflineSuggestions ??
          successActor({ isRequestedAmountSendableOffline: false }),
        checkFiatOfflineOptimization:
          overrides.checkFiatOfflineOptimization ??
          successActor({ fiatOfflineAmount: null }),
        resolveLnUrl: overrides.resolveLnUrl ?? successActor({ invoice: 'lnbc...' }),
        prepareMeltQuote: overrides.prepareMeltQuote ?? successActor(mockMeltQuoteResult),
        executeMeltQuote: overrides.executeMeltQuote ?? successActor(undefined),
        rollbackMelt: overrides.rollbackMelt ?? successActor(undefined),
        selectBestMint:
          overrides.selectBestMint ??
          successActor({ mintUrl: 'https://mint.example' }),
        requestCameraPermission:
          overrides.requestCameraPermission ?? successActor({ status: 'granted' }),
        nfcReadRequest:
          overrides.nfcReadRequest ??
          successActor({
            rawData: 'creqA...',
            paymentRequest: 'creqA...',
            amount: 100,
            allowedMints: [],
          }),
        nfcWriteToken: overrides.nfcWriteToken ?? successActor(undefined),
      },
      actions: {
        hapticSuccess: noopAction,
        hapticError: noopAction,
        linkTransaction: noopAction,
      },
    },
  );
}

// ===========================================================================
// Ecash Send Branch Tests
// ===========================================================================

describe('sendMachine — ecash branch', () => {
  it('transitions idle → noMint when no mint selected', () => {
    const machine = makeSendMachine({});
    const actor = createActor(machine, {
      input: { sendBranch: 'ecash', mintUrl: null, amount: 100, mintBalance: 500, manager: null },
    });
    actor.start();
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('noMint');
    expect(actor.getSnapshot().status).toBe('done');
  });

  it('transitions idle → insufficientBalance when balance too low', () => {
    const machine = makeSendMachine({});
    const actor = createActor(machine, {
      input: {
        sendBranch: 'ecash',
        mintUrl: 'https://mint.example',
        amount: 500,
        mintBalance: 100,
        manager: null,
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('insufficientBalance');
  });

  it('stays idle when amount is 0', () => {
    const machine = makeSendMachine({});
    const actor = createActor(machine, {
      input: {
        sendBranch: 'ecash',
        mintUrl: 'https://mint.example',
        amount: 0,
        mintBalance: 500,
        manager: null,
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('sends ecash and reaches success', async () => {
    const machine = makeSendMachine({ sendEcash: successActor(mockSendResult) });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'ecash',
        mintUrl: 'https://mint.example',
        amount: 100,
        mintBalance: 500,
        manager: {} as any,
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('success');
    expect(snapshot.context.token).toBe(mockSendResult.token);
    expect(snapshot.context.operationId).toBe('op-1');
  });

  it('enters offlineSuggestions when offline and not exact amount', () => {
    const machine = makeSendMachine({
      getOfflineSuggestions: successActor({
        isRequestedAmountSendableOffline: false,
        roundDownAmount: 64,
        roundUpAmount: 128,
      }),
    });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'ecash',
        mintUrl: 'https://mint.example',
        amount: 100,
        mintBalance: 500,
        isOffline: true,
        manager: {} as any,
        offlineSendability: { reachableSums: [64, 128], totalReadyBalance: 192 },
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    // Machine enters setup.checkingOffline → setup.offlineSuggestions
    const snap = actor.getSnapshot();
    // Since 100 is not in reachableSums, goes to offlineSuggestions
    expect(JSON.stringify(snap.value)).toContain('offlineSuggestions');
  });

  it('sends with offline fallback after send failure', async () => {
    let sendAttempt = 0;
    const machine = makeSendMachine({
      sendEcash: fromPromise(async () => {
        sendAttempt++;
        if (sendAttempt === 1) throw new Error('Network error');
        return mockSendResult;
      }),
    });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'ecash',
        mintUrl: 'https://mint.example',
        amount: 100,
        mintBalance: 500,
        manager: {} as any,
        offlineSendability: { reachableSums: [64, 128], totalReadyBalance: 192 },
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    // Wait for offlineFallbackSuggestions state
    await waitFor(
      actor,
      (s) => JSON.stringify(s.value).includes('offlineFallbackSuggestions'),
      { timeout: 2_000 },
    );

    // Select a different amount and retry
    actor.send({ type: 'SELECT_AMOUNT', amount: 64 });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('success');
    expect(snapshot.context.amount).toBe(64);
  });

  it('applies fiat offline optimization when eligible', async () => {
    const machine = makeSendMachine({
      checkFiatOfflineOptimization: successActor({ fiatOfflineAmount: 98 }),
      sendEcash: successActor(mockSendResult),
    });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'ecash',
        mintUrl: 'https://mint.example',
        amount: 100,
        mintBalance: 500,
        manager: {} as any,
        unit: 'usd',
        btcPrice: 50000,
        offlineSendability: { reachableSums: [98], totalReadyBalance: 98 },
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('success');
    expect(snapshot.context.fiatOfflineAmount).toBe(98);
    expect(snapshot.context.amount).toBe(98);
  });
});

// ===========================================================================
// Melt Send Branch Tests
// ===========================================================================

describe('sendMachine — melt branch', () => {
  it('resolves LNURL then prepares quote', async () => {
    const machine = makeSendMachine({
      resolveLnUrl: successActor({ invoice: 'lnbc1resolved...' }),
      prepareMeltQuote: successActor(mockMeltQuoteResult),
    });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'melt',
        mintUrl: 'https://mint.example',
        amount: 100,
        manager: {} as any,
        lnUrlOrAddress: 'user@example.com',
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    const snapshot = await waitFor(
      actor,
      (s) => JSON.stringify(s.value).includes('quoteReady'),
      { timeout: 2_000 },
    );
    expect(snapshot.context.invoice).toBe('lnbc1resolved...');
    expect(snapshot.context.quote).toBeTruthy();
  });

  it('executes melt and reaches success', async () => {
    const machine = makeSendMachine({
      prepareMeltQuote: successActor(mockMeltQuoteResult),
      executeMeltQuote: successActor(undefined),
    });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'melt',
        mintUrl: 'https://mint.example',
        amount: 100,
        manager: {} as any,
        invoice: 'lnbc1...',
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    // Wait for quoteReady
    await waitFor(actor, (s) => JSON.stringify(s.value).includes('quoteReady'), {
      timeout: 2_000,
    });
    actor.send({ type: 'EXECUTE' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('success');
  });

  it('cancels melt and rolls back', async () => {
    const machine = makeSendMachine({
      prepareMeltQuote: successActor(mockMeltQuoteResult),
      rollbackMelt: successActor(undefined),
    });
    const actor = createActor(machine, {
      input: {
        sendBranch: 'melt',
        mintUrl: 'https://mint.example',
        amount: 100,
        manager: {} as any,
        invoice: 'lnbc1...',
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => JSON.stringify(s.value).includes('quoteReady'), {
      timeout: 2_000,
    });
    actor.send({ type: 'CANCEL' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('cancelled');
  });

  it('errors when no address or invoice', async () => {
    const machine = makeSendMachine({});
    const actor = createActor(machine, {
      input: {
        sendBranch: 'melt',
        mintUrl: 'https://mint.example',
        amount: 100,
        manager: {} as any,
      },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('error');
    expect(snapshot.context.error?.code).toBe('NO_ADDRESS');
  });
});

// ===========================================================================
// NFC Branch Tests
// ===========================================================================

describe('sendMachine — NFC branch', () => {
  it('reads NFC, selects mint, creates token, writes back', async () => {
    const machine = makeSendMachine({
      nfcReadRequest: successActor({
        rawData: 'creqA...',
        paymentRequest: 'creqA...',
        amount: 100,
        allowedMints: [],
      }),
      selectBestMint: successActor({ mintUrl: 'https://mint.example' }),
      sendEcash: successActor(mockSendResult),
      nfcWriteToken: successActor(undefined),
    });
    const actor = createActor(machine, {
      input: { manager: {} as any },
    });
    actor.start();
    actor.send({ type: 'START_NFC' });

    // Wait for waitingFinalization
    await waitFor(
      actor,
      (s) => JSON.stringify(s.value).includes('waitingFinalization'),
      { timeout: 2_000 },
    );

    actor.send({
      type: 'FINALIZED',
      historyEntry: mockSendResult.historyEntry as any,
    });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('success');
  });

  it('errors when wallet not ready', () => {
    const machine = makeSendMachine({});
    const actor = createActor(machine, {
      input: { manager: null },
    });
    actor.start();
    actor.send({ type: 'START_NFC' });

    const snap = actor.getSnapshot();
    expect(snap.value).toBe('error');
    expect(snap.context.error?.code).toBe('WALLET_NOT_READY');
  });

  it('rolls back on NFC write failure', async () => {
    let rolledBack = false;
    const machine = makeSendMachine({
      nfcReadRequest: successActor({
        rawData: 'creqA...',
        paymentRequest: 'creqA...',
        amount: 100,
        allowedMints: [],
      }),
      selectBestMint: successActor({ mintUrl: 'https://mint.example' }),
      sendEcash: successActor(mockSendResult),
      nfcWriteToken: failActor('Write failed'),
      rollbackSend: fromPromise(async () => {
        rolledBack = true;
      }),
    });
    const actor = createActor(machine, {
      input: { manager: {} as any },
    });
    actor.start();
    actor.send({ type: 'START_NFC' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('error');
    expect(rolledBack).toBe(true);
  });
});

// ===========================================================================
// Input/Routing Phase Tests
// ===========================================================================

describe('sendMachine — input routing', () => {
  it('routes ecash token to routeEcashReceive', async () => {
    const machine = makeSendMachine({
      requestCameraPermission: successActor({ status: 'granted' }),
      parsePaymentString: fromPromise(async () => ({ type: 'ecash', data: 'cashuB...' })),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'cashuB...', source: 'qr' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('routeEcashReceive');
  });

  it('routes payment request correctly', async () => {
    const machine = makeSendMachine({
      requestCameraPermission: successActor({ status: 'granted' }),
      parsePaymentString: fromPromise(async () => ({ type: 'paymentRequest', data: 'creqA...' })),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'creqA...', source: 'qr' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('routePaymentRequest');
  });

  it('routes lightning invoice correctly', async () => {
    const machine = makeSendMachine({
      parsePaymentString: fromPromise(async () => ({
        type: 'lightningInvoice',
        data: 'lnbc1...',
      })),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'lnbc1...', source: 'paste' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('routeLightning');
  });

  it('routes mint URL correctly', async () => {
    const machine = makeSendMachine({
      requestCameraPermission: successActor({ status: 'granted' }),
      parsePaymentString: fromPromise(async () => ({
        type: 'mintUrl',
        data: 'https://mint.example',
      })),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'https://mint.example', source: 'qr' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('routeMintUrl');
  });

  it('denies when camera permission denied', async () => {
    const machine = makeSendMachine({
      requestCameraPermission: successActor({ status: 'denied' }),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'cashuB...', source: 'qr' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('permissionDenied');
  });

  it('skips permission check for paste source', async () => {
    const machine = makeSendMachine({
      parsePaymentString: fromPromise(async () => ({ type: 'ecash', data: 'cashuB...' })),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'cashuB...', source: 'paste' });

    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('routeEcashReceive');
  });

  it('handles UR progress and completion', async () => {
    const machine = makeSendMachine({
      requestCameraPermission: successActor({ status: 'granted' }),
      parsePaymentString: fromPromise(async () => ({ type: 'ur', data: 'ur:...' })),
    });
    const actor = createActor(machine, { input: {} });
    actor.start();
    actor.send({ type: 'SCAN', data: 'ur:...', source: 'qr' });

    await waitFor(actor, (s) => s.value === 'routeUR', { timeout: 2_000 });

    actor.send({ type: 'UR_PROGRESS', progress: 0.5 });
    expect(actor.getSnapshot().context.urProgress).toBe(0.5);

    actor.send({ type: 'UR_COMPLETE', data: 'cashuBcompleted' });
    const snapshot = await waitFor(actor, (s) => s.status === 'done', { timeout: 2_000 });
    expect(snapshot.value).toBe('routeEcashReceive');
    expect(snapshot.context.parsedResult?.data).toBe('cashuBcompleted');
  });
});

// ===========================================================================
// mintQuoteMachine Tests (stays separate)
// ===========================================================================

function makeMintQuoteMachine(overrides: {
  requestLightningInvoice?: any;
  captureLocation?: any;
}) {
  return createMachine(
    {
      id: 'mintQuote',
      types: {} as {
        context: MintQuoteContext;
        events:
          | { type: 'NEXT' }
          | { type: 'PAYMENT_RECEIVED' }
          | { type: 'REDEEMED' }
          | { type: 'QUOTE_EXPIRED' }
          | { type: 'SET_AMOUNT'; amount: number }
          | { type: 'SET_MINT'; mintUrl: string }
          | { type: 'SET_MANAGER'; manager: any };
        input: MintQuoteInput;
      },
      context: ({ input }): MintQuoteContext => ({
        type: 'mintQuote',
        mintUrl: input.mintUrl ?? null,
        amount: input.amount ?? 0,
        mintBalance: 0,
        isOffline: false,
        manager: input.manager,
        error: null,
        mintQuote: null,
        historyEntry: null,
      }),
      initial: 'idle',
      states: {
        idle: {
          on: {
            SET_AMOUNT: { actions: assign({ amount: ({ event }) => event.amount }) },
            SET_MINT: { actions: assign({ mintUrl: ({ event }) => event.mintUrl }) },
            SET_MANAGER: { actions: assign({ manager: ({ event }) => event.manager }) },
            NEXT: [
              { guard: ({ context }) => !context.manager, target: 'idle' },
              { guard: ({ context }) => !context.mintUrl, target: 'noMint' },
              { guard: ({ context }) => !(context.amount > 0), target: 'idle' },
              { target: 'requestingInvoice' },
            ],
          },
        },
        noMint: { type: 'final' as const, entry: 'hapticError' },
        requestingInvoice: {
          invoke: {
            src: 'requestLightningInvoice',
            input: ({ context }) => ({
              mintUrl: context.mintUrl!,
              amount: context.amount,
              manager: context.manager!,
            }),
            onDone: {
              target: 'capturingLocation',
              actions: assign({
                mintQuote: ({ event }) => (event as any).output.mintQuote,
                historyEntry: ({ event }) => (event as any).output.historyEntry,
              }),
            },
            onError: { target: 'invoiceError' },
          },
        },
        capturingLocation: {
          invoke: {
            src: 'captureLocation',
            input: ({ context }) => ({ transactionId: context.historyEntry!.id }),
            onDone: { target: 'invoiceReady' },
            onError: { target: 'invoiceReady' },
          },
        },
        invoiceReady: {
          on: {
            PAYMENT_RECEIVED: { target: 'paid', actions: 'hapticSuccess' },
            QUOTE_EXPIRED: { target: 'expired' },
          },
        },
        paid: { on: { REDEEMED: { target: 'redeemed' } } },
        redeemed: { type: 'final' as const, entry: 'hapticSuccess' },
        expired: { type: 'final' as const },
        invoiceError: { type: 'final' as const, entry: 'hapticError' },
      },
    },
    {
      actors: {
        requestLightningInvoice:
          overrides.requestLightningInvoice ?? successActor(mockMintQuoteResult),
        captureLocation: overrides.captureLocation ?? successActor(true),
      },
      actions: {
        hapticSuccess: noopAction,
        hapticError: noopAction,
      },
    },
  );
}

describe('mintQuoteMachine', () => {
  it('transitions idle → noMint when no mint selected', () => {
    const machine = makeMintQuoteMachine({});
    const actor = createActor(machine, { input: { mintUrl: null, manager: {} as any } });
    actor.start();
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('noMint');
  });

  it('requests invoice and reaches invoiceReady', async () => {
    const machine = makeMintQuoteMachine({});
    const actor = createActor(machine, {
      input: { mintUrl: 'https://mint.example', amount: 100, manager: {} as any },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    const snapshot = await waitFor(actor, (s) => s.value === 'invoiceReady', { timeout: 2_000 });
    expect(snapshot.context.mintQuote).toBeTruthy();
    expect(snapshot.context.historyEntry).toBeTruthy();
  });

  it('handles payment received → paid → redeemed', async () => {
    const machine = makeMintQuoteMachine({});
    const actor = createActor(machine, {
      input: { mintUrl: 'https://mint.example', amount: 100, manager: {} as any },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'invoiceReady', { timeout: 2_000 });
    actor.send({ type: 'PAYMENT_RECEIVED' });
    expect(actor.getSnapshot().value).toBe('paid');
    actor.send({ type: 'REDEEMED' });
    expect(actor.getSnapshot().value).toBe('redeemed');
    expect(actor.getSnapshot().status).toBe('done');
  });

  it('handles quote expired', async () => {
    const machine = makeMintQuoteMachine({});
    const actor = createActor(machine, {
      input: { mintUrl: 'https://mint.example', amount: 100, manager: {} as any },
    });
    actor.start();
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'invoiceReady', { timeout: 2_000 });
    actor.send({ type: 'QUOTE_EXPIRED' });
    expect(actor.getSnapshot().value).toBe('expired');
    expect(actor.getSnapshot().status).toBe('done');
  });
});
