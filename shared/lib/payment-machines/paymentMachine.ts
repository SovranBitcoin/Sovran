import { assign, createMachine, fromCallback, fromPromise } from 'xstate';

import { isLightningInvoice, isValidEcashToken } from '@/shared/lib/cashu/utils';

import {
  captureLocationActor,
  checkFiatOfflineOptimizationActor,
  executeMeltQuoteActor,
  getOfflineSuggestionsActor,
  prepareMeltQuoteActor,
  receiveEcashActor,
  redeemMintQuoteActor,
  requestCameraPermissionActor,
  requestLightningInvoiceActor,
  resolveLnUrlActor,
  rollbackMeltActor,
  rollbackSendActor,
  rotateP2PKKeyActor,
  selectBestMintActor,
  sendEcashActor,
  sendPaymentRequestPlaceholder,
} from './actors';
import {
  assignError,
  hapticErrorAction,
  hapticSuccessAction,
  linkMeltTransactionAction,
  linkReceiveTransactionAction,
  linkTransactionAction,
  noMintPopupAction,
  paymentRequestSentPopupAction,
  receiveEcashErrorAction,
  receiveEcashStartAction,
} from './actions';
import {
  isAmountValid,
  isBalanceSufficient,
  isExactOfflineAmount,
  isMintSelected,
  isOffline,
} from './guards';

import type {
  PaymentMachineContext,
  PaymentMachineEvent,
  PaymentMachineInput,
} from './paymentMachine.types';
import type { PaymentError } from './types';
import type { ParsedPaymentString, ParsedPaymentType } from './sendMachine.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeError(code: string, error: unknown, recoverable = false): PaymentError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    recoverable,
  };
}

// ---------------------------------------------------------------------------
// Parsing actor (absorbed from qrScanRouterMachine)
// ---------------------------------------------------------------------------

const parsePaymentStringActor = fromPromise(
  async ({ input }: { input: { data: string } }): Promise<ParsedPaymentString> => {
    const trimmed = input.data.trim();
    // Bolt11 QR codes are commonly encoded in uppercase per bech32 spec.
    // Strip the optional `lightning:` URI prefix and normalize to lowercase
    // so isLightningInvoice / decode() work regardless of source casing.
    const lnPrefixes = ['lightning:', 'lnurl', 'lnbc', 'lntb'];
    const trimmedLower = trimmed.toLowerCase();
    const lnPrefix = lnPrefixes.find((p) => trimmedLower.startsWith(p));
    // Normalize: strip `lightning:` prefix and lowercase for bolt11 detection
    const normalizedForLn =
      lnPrefix === 'lightning:' ? trimmedLower.slice('lightning:'.length) : trimmedLower;

    if (trimmedLower.startsWith('ur:')) {
      return { type: 'ur', data: trimmed };
    }

    if (isValidEcashToken(trimmed)) {
      return { type: 'ecash', data: trimmed };
    }

    if (trimmed.startsWith('creqA')) {
      return { type: 'paymentRequest', data: trimmed };
    }

    if (isLightningInvoice(normalizedForLn)) {
      return { type: 'lightningInvoice', data: normalizedForLn };
    }

    const isLnPrefix = !!lnPrefix;
    if (isLnPrefix && !isLightningInvoice(normalizedForLn)) {
      // lnurl / lnbc that decode() rejects = treat as Lightning address / LNURL
      return { type: 'lightningAddress', data: trimmed };
    }

    if (trimmed.includes('@') && !trimmed.startsWith('http')) {
      return { type: 'lightningAddress', data: trimmed };
    }

    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return { type: 'mintUrl', data: trimmed };
    }

    if (trimmed.startsWith('npub1') || trimmed.startsWith('nprofile1')) {
      return { type: 'npub', data: trimmed };
    }

    return { type: 'unknown', data: trimmed };
  }
);

// ---------------------------------------------------------------------------
// NFC placeholder actors (provided via .provide() at call site)
// ---------------------------------------------------------------------------

const nfcReadRequestPlaceholder = fromPromise(
  async ({
    input,
  }: {
    input: { maxAmountSats?: number };
  }): Promise<{
    rawData: string;
    paymentRequest: string;
    amount: number;
    allowedMints: string[];
  }> => {
    throw new Error('nfcReadRequest must be provided via machine.provide()');
  }
);

const nfcWriteTokenPlaceholder = fromPromise(
  async ({ input }: { input: { token: string } }): Promise<void> => {
    throw new Error('nfcWriteToken must be provided via machine.provide()');
  }
);

// ---------------------------------------------------------------------------
// Guards (local helpers for routing)
// ---------------------------------------------------------------------------

function isParsedType(type: ParsedPaymentType) {
  return ({ context }: { context: PaymentMachineContext }) => context.parsedResult?.type === type;
}

// ---------------------------------------------------------------------------
// Machine
// ---------------------------------------------------------------------------

export const paymentMachine = createMachine(
  {
    id: 'payment',
    types: {} as {
      context: PaymentMachineContext;
      events: PaymentMachineEvent;
      input: PaymentMachineInput;
    },
    context: ({ input }): PaymentMachineContext => ({
      // Source
      source: input.source ?? 'direct',
      rawData: null,
      parsedResult: null,

      // Camera / UR
      cameraPermission: 'unknown',
      urProgress: 0,

      // Core payment
      mintUrl: input.mintUrl ?? null,
      amount: input.amount ?? 0,
      mintBalance: input.mintBalance ?? 0,
      isOffline: input.isOffline ?? false,
      manager: input.manager ?? null,
      error: null,

      // Branch
      sendBranch: input.sendBranch ?? null,

      // Ecash
      token: null,
      historyEntry: null,
      operationId: null,
      offlineSendability: input.offlineSendability ?? null,
      offlineSuggestions: null,
      fiatOfflineAmount: null,
      unit: input.unit ?? 'sat',
      scanRaw: input.scanRaw ?? null,
      btcPrice: input.btcPrice ?? null,

      // Melt
      lnUrlOrAddress: input.lnUrlOrAddress ?? null,
      invoice: input.invoice ?? null,
      quote: null,
      meltHistoryEntry: null,
      meltOperationId: null,

      // NFC
      maxAmountSats: input.maxAmountSats,
      allowedMints: [],
      selectedMint: null,
      paymentRequest: null,

      // Payment request
      isPaymentRequest: false,
      encodedPaymentRequest: input.encodedPaymentRequest ?? null,

      // mintQuote (receive Lightning)
      mintQuoteData: null,
      mintHistoryEntry: null,

      // Ecash receive
      receiveBranch: input.receiveBranch ?? null,
      tokenString: input.tokenString ?? null,
      isAlreadySpent: false,
      receiveHistoryEntry: null,
    }),
    initial: 'routing',
    states: {
      // =================================================================
      // ROUTING — immediately branches to correct initial state
      // =================================================================
      routing: {
        always: [
          {
            guard: ({ context }) => context.receiveBranch === 'ecashReceive',
            target: 'ecashReceive',
          },
          { target: 'idle' },
        ],
      },

      // =================================================================
      // IDLE — ready for input or direct progression
      // =================================================================
      idle: {
        on: {
          // Input events (QR/paste/deeplink scanning)
          SCAN: {
            target: 'input',
            actions: assign({
              rawData: ({ event }) => event.data,
              source: ({ event }) => event.source,
              parsedResult: null,
            }),
          },

          // NFC input
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

          // Direct setup events (when machine starts in 'direct' mode)
          SET_AMOUNT: {
            actions: assign({ amount: ({ event }) => event.amount }),
          },
          SET_RECEIVE_AMOUNT: {
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
          SET_PAYMENT_REQUEST: {
            actions: assign({
              sendBranch: 'paymentRequest' as const,
              encodedPaymentRequest: ({ event }) => event.encodedPaymentRequest,
            }),
          },

          // Receive Lightning: request invoice
          REQUEST_INVOICE: [
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
              guard: ({ context }) => !isMintSelected({ context }),
              target: 'noMint',
            },
            {
              guard: ({ context }) => !isAmountValid({ context }),
              target: 'idle',
            },
            { target: 'mintQuote' },
          ],

          // Direct progression (ecash send / melt)
          NEXT: [
            {
              guard: ({ context }) => !context.manager,
              target: 'idle',
            },
            {
              guard: ({ context }) => !isMintSelected({ context }),
              target: 'noMint',
            },
            // Melt branch — amount lives inside the bolt11 invoice, not context.amount
            {
              guard: ({ context }) => context.sendBranch === 'melt',
              target: 'meltSend',
            },
            // Payment request branch — ecash + Nostr DM, amount from decoded PR
            {
              guard: ({ context }) => context.sendBranch === 'paymentRequest',
              target: 'paymentRequestSending',
            },
            {
              guard: ({ context }) => !isAmountValid({ context }),
              target: 'idle',
            },
            // Ecash branch — check balance then route
            {
              guard: ({ context }) => !isBalanceSufficient({ context }),
              target: 'insufficientBalance',
            },
            {
              guard: ({ context }) => isOffline({ context }),
              target: 'setup',
              actions: assign({ sendBranch: 'ecash' as const }),
            },
            {
              // Fiat mode online: try auto-offline optimization
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

      // Terminal: no mint selected
      noMint: {
        type: 'final' as const,
        entry: ['hapticError', 'popupNoMint', 'onNoMintCallback'],
      },

      // Terminal: insufficient balance
      insufficientBalance: {
        type: 'final' as const,
        entry: ['hapticError', 'onInsufficientBalanceCallback'],
      },

      // =================================================================
      // INPUT — Parse & route scanned/pasted/NFC data
      // =================================================================
      input: {
        initial: 'deciding',
        states: {
          deciding: {
            always: [
              // NFC source → go read from card
              {
                guard: ({ context }) => context.source === 'nfc',
                target: 'readingNfc',
              },
              // QR source → check camera permission first
              {
                guard: ({ context }) =>
                  context.source === 'qr' && context.cameraPermission !== 'granted',
                target: 'checkingPermission',
              },
              // Already have permission or paste/deeplink → parse
              { target: 'parsing' },
            ],
          },

          checkingPermission: {
            invoke: {
              src: 'requestCameraPermission',
              onDone: [
                {
                  guard: ({ event }) => event.output.status === 'granted',
                  target: 'parsing',
                  actions: assign({ cameraPermission: 'granted' as const }),
                },
                {
                  target: '#payment.permissionDenied',
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
              input: ({ context }: { context: PaymentMachineContext }) => ({
                data: context.rawData!,
              }),
              onDone: {
                target: 'routing',
                actions: assign({
                  parsedResult: ({ event }) => event.output,
                }),
              },
              onError: { target: '#payment.idle' },
            },
          },

          routing: {
            always: [
              { guard: isParsedType('ur'), target: '#payment.routeUR' },
              { guard: isParsedType('ecash'), target: '#payment.routeEcashReceive' },
              { guard: isParsedType('paymentRequest'), target: '#payment.routePaymentRequest' },
              { guard: isParsedType('lightningInvoice'), target: '#payment.routeLightning' },
              { guard: isParsedType('lightningAddress'), target: '#payment.routeLightning' },
              { guard: isParsedType('mintUrl'), target: '#payment.routeMintUrl' },
              { guard: isParsedType('npub'), target: '#payment.routeNpub' },
              { target: '#payment.idle' },
            ],
          },

          // NFC: read payment request from card
          readingNfc: {
            invoke: {
              src: 'nfcReadRequest',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                maxAmountSats: context.maxAmountSats,
              }),
              onDone: {
                target: 'decodingNfcRequest',
                actions: assign(({ event }) => ({
                  rawData: event.output.rawData,
                  paymentRequest: event.output.paymentRequest,
                  amount: event.output.amount,
                  allowedMints: event.output.allowedMints,
                })),
              },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }): PaymentError => ({
                    code: (event.error as { code?: string })?.code ?? 'NFC_READ_FAILED',
                    message:
                      event.error instanceof Error ? event.error.message : String(event.error),
                    recoverable: true,
                  }),
                }),
              },
            },
          },

          decodingNfcRequest: {
            always: [
              // Lightning invoice detected on NFC → redirect
              {
                guard: ({ context }) => !!context.rawData && isLightningInvoice(context.rawData),
                target: '#payment.lightningRedirect',
              },
              // Ecash payment request → select mint
              { target: '#payment.setup' },
            ],
          },
        },
      },

      // =================================================================
      // ROUTING TERMINALS — machine reaches these, React does navigation
      // =================================================================

      routeUR: {
        on: {
          UR_PROGRESS: {
            actions: assign({
              urProgress: ({ event }) => event.progress,
            }),
          },
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

      routeEcashReceive: { type: 'final' as const, entry: 'navigateToReceiveToken' },
      routePaymentRequest: { type: 'final' as const, entry: 'navigateToPaymentRequest' },
      routeLightning: { type: 'final' as const, entry: 'navigateToLightning' },
      routeMintUrl: { type: 'final' as const, entry: 'navigateToMintUrl' },
      routeNpub: { type: 'final' as const, entry: 'navigateToNpub' },
      permissionDenied: { type: 'final' as const },

      lightningRedirect: { type: 'final' as const, entry: 'navigateToLightningRedirect' },

      // =================================================================
      // SETUP — Validate & prepare for execution
      // =================================================================
      setup: {
        initial: 'deciding',
        states: {
          deciding: {
            always: [
              // NFC branch needs mint selection first
              {
                guard: ({ context }) => context.sendBranch === 'nfc',
                target: 'selectingMint',
              },
              // Offline ecash → check exact amount
              {
                guard: ({ context }) => context.sendBranch === 'ecash' && isOffline({ context }),
                target: 'checkingOffline',
              },
              // Fiat auto-offline optimization
              {
                guard: ({ context }) =>
                  context.sendBranch === 'ecash' &&
                  context.unit !== 'sat' &&
                  !!context.btcPrice &&
                  !!context.offlineSendability &&
                  context.offlineSendability.totalReadyBalance > 0,
                target: 'checkingFiatOffline',
              },
              // Default: go to execution
              {
                guard: ({ context }) => context.sendBranch === 'ecash',
                target: '#payment.ecashSend',
              },
              {
                guard: ({ context }) => context.sendBranch === 'melt',
                target: '#payment.meltSend',
              },
              // Fallback
              { target: '#payment.ecashSend' },
            ],
          },

          selectingMint: {
            invoke: {
              src: 'selectBestMint',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                allowedMints: context.allowedMints.length > 0 ? context.allowedMints : undefined,
                availableMints: {} as Record<string, number>,
                amount: context.amount,
                preferredMint: context.mintUrl ?? undefined,
              }),
              onDone: {
                target: '#payment.ecashSend',
                actions: assign({
                  selectedMint: ({ event }) => event.output.mintUrl,
                  mintUrl: ({ event }) => event.output.mintUrl,
                }),
              },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }): PaymentError => ({
                    code: (event.error as { code?: string })?.code ?? 'MINT_SELECTION_FAILED',
                    message:
                      event.error instanceof Error ? event.error.message : String(event.error),
                    recoverable: false,
                  }),
                }),
              },
            },
          },

          checkingOffline: {
            always: [
              {
                guard: ({ context }) => isExactOfflineAmount({ context } as any),
                target: '#payment.ecashSend',
              },
              { target: 'offlineSuggestions' },
            ],
          },

          offlineSuggestions: {
            initial: 'loading',
            states: {
              loading: {
                invoke: {
                  src: 'getOfflineSuggestions',
                  input: ({ context }: { context: PaymentMachineContext }) => ({
                    proofService: (context.manager as any)?.proofService,
                    mintUrl: context.mintUrl!,
                    amount: context.amount,
                  }),
                  onDone: [
                    {
                      guard: ({ event }) =>
                        (event.output as { isRequestedAmountSendableOffline?: boolean })
                          .isRequestedAmountSendableOffline === true,
                      target: '#payment.ecashSend',
                    },
                    {
                      target: 'prompting',
                      actions: assign({
                        offlineSuggestions: ({ event }) => event.output,
                      }),
                    },
                  ],
                  onError: {
                    target: '#payment.error',
                    actions: assign({
                      error: ({ event }) => makeError('OFFLINE_SUGGESTIONS_FAILED', event.error),
                    }),
                  },
                },
              },
              prompting: {
                invoke: {
                  src: 'showOfflineSuggestionsPopup',
                  input: ({ context }: { context: PaymentMachineContext }) => ({
                    requestedAmount: context.amount,
                    suggestions: context.offlineSuggestions,
                    unit: context.unit,
                  }),
                },
                on: {
                  SELECT_AMOUNT: {
                    target: '#payment.ecashSend',
                    actions: assign({ amount: ({ event }) => event.amount }),
                  },
                  CANCEL: { target: '#payment.cancelled' },
                },
              },
            },
          },

          checkingFiatOffline: {
            invoke: {
              src: 'checkFiatOfflineOptimization',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                proofService: (context.manager as any)?.proofService,
                mintUrl: context.mintUrl!,
                amount: context.amount,
                btcPrice: context.btcPrice!,
              }),
              onDone: [
                {
                  guard: ({ event }) => event.output.fiatOfflineAmount != null,
                  target: '#payment.ecashSend',
                  actions: assign({
                    fiatOfflineAmount: ({ event }) => event.output.fiatOfflineAmount,
                    amount: ({ event }) => event.output.fiatOfflineAmount ?? 0,
                  }),
                },
                { target: '#payment.ecashSend' },
              ],
              onError: { target: '#payment.ecashSend' },
            },
          },
        },
      },

      // =================================================================
      // ECASH SEND — Create and send ecash token
      // =================================================================
      ecashSend: {
        initial: 'sending',
        states: {
          sending: {
            invoke: {
              src: 'sendEcash',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                mintUrl: (context.selectedMint || context.mintUrl)!,
                amount: context.amount,
                manager: context.manager!,
              }),
              onDone: {
                target: 'capturingLocation',
                actions: assign({
                  token: ({ event }) => event.output.token,
                  historyEntry: ({ event }) => event.output.historyEntry,
                  operationId: ({ event }) => event.output.operationId,
                }),
              },
              onError: {
                target: 'sendFailed',
                actions: assign({
                  error: ({ event }) => makeError('SEND_FAILED', event.error),
                }),
              },
            },
          },

          sendFailed: {
            always: [
              {
                guard: ({ context }) => !!context.operationId,
                target: 'rollingBack',
              },
              { target: 'offlineFallback' },
            ],
          },

          rollingBack: {
            invoke: {
              src: 'rollbackSend',
              input: ({ context }: { context: PaymentMachineContext }) => ({
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
              { target: '#payment.error' },
            ],
          },

          offlineFallbackSuggestions: {
            initial: 'loading',
            states: {
              loading: {
                invoke: {
                  src: 'getOfflineSuggestions',
                  input: ({ context }: { context: PaymentMachineContext }) => ({
                    proofService: (context.manager as any)?.proofService,
                    mintUrl: context.mintUrl!,
                    amount: context.amount,
                  }),
                  onDone: {
                    target: 'prompting',
                    actions: assign({
                      offlineSuggestions: ({ event }) => event.output,
                    }),
                  },
                  onError: {
                    target: '#payment.error',
                    actions: assign({
                      error: ({ event }) => makeError('OFFLINE_FALLBACK_FAILED', event.error),
                    }),
                  },
                },
              },
              prompting: {
                invoke: {
                  src: 'showOfflineSuggestionsPopup',
                  input: ({ context }: { context: PaymentMachineContext }) => ({
                    requestedAmount: context.amount,
                    suggestions: context.offlineSuggestions,
                    unit: context.unit,
                  }),
                },
                on: {
                  SELECT_AMOUNT: {
                    target: '#payment.ecashSend.sending',
                    actions: assign({
                      amount: ({ event }) => event.amount,
                      error: null,
                      operationId: null,
                    }),
                  },
                  CANCEL: { target: '#payment.error' },
                },
              },
            },
          },

          capturingLocation: {
            invoke: {
              src: 'captureLocation',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                transactionId: context.historyEntry!.id,
              }),
              onDone: [
                // NFC branch → write token to card
                {
                  guard: ({ context }) => context.sendBranch === 'nfc',
                  target: '#payment.nfcWrite',
                },
                { target: '#payment.success' },
              ],
              onError: [
                {
                  guard: ({ context }) => context.sendBranch === 'nfc',
                  target: '#payment.nfcWrite',
                },
                { target: '#payment.success' },
              ],
            },
          },
        },
      },

      // =================================================================
      // MELT SEND — Lightning payment via melt quote
      // =================================================================
      meltSend: {
        initial: 'validating',
        states: {
          validating: {
            always: [
              {
                guard: ({ context }) => !isMintSelected({ context }),
                target: '#payment.noMint',
              },
              {
                guard: ({ context }) => !context.lnUrlOrAddress && !context.invoice,
                target: '#payment.error',
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
              {
                guard: ({ context }) => !!context.invoice,
                target: 'preparingQuote',
              },
            ],
          },

          resolvingLnUrl: {
            invoke: {
              src: 'resolveLnUrl',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                lnUrlOrAddress: context.lnUrlOrAddress!,
                amount: context.amount,
              }),
              onDone: {
                target: 'preparingQuote',
                actions: assign({
                  invoice: ({ event }) => event.output.invoice,
                }),
              },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('LNURL_RESOLUTION_FAILED', event.error, true),
                }),
              },
            },
          },

          preparingQuote: {
            invoke: {
              src: 'prepareMeltQuote',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                mintUrl: context.mintUrl!,
                invoice: context.invoice!,
                manager: context.manager!,
              }),
              onDone: {
                target: 'quoteReady',
                actions: assign({
                  quote: ({ event }) => event.output.quote,
                  meltHistoryEntry: ({ event }) => event.output.historyEntry,
                  meltOperationId: ({ event }) => event.output.operationId,
                }),
              },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('QUOTE_PREPARATION_FAILED', event.error),
                }),
              },
            },
          },

          quoteReady: {
            entry: 'linkMeltTransaction',
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
              input: ({ context }: { context: PaymentMachineContext }) => ({
                operationId: context.meltOperationId!,
                manager: context.manager!,
              }),
              onDone: { target: 'capturingLocation' },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('MELT_EXECUTION_FAILED', event.error),
                }),
              },
            },
          },

          cancelling: {
            invoke: {
              src: 'rollbackMelt',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                operationId: context.meltOperationId!,
                reason: 'User cancelled',
                manager: context.manager!,
              }),
              onDone: { target: '#payment.cancelled' },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('CANCEL_FAILED', event.error),
                }),
              },
            },
          },

          capturingLocation: {
            invoke: {
              src: 'captureLocation',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                transactionId: context.meltHistoryEntry!.id,
              }),
              onDone: { target: '#payment.success' },
              onError: { target: '#payment.success' },
            },
          },
        },
      },

      // =================================================================
      // NFC WRITE — Write ecash token back to NFC card
      // =================================================================
      nfcWrite: {
        initial: 'writingToken',
        states: {
          writingToken: {
            invoke: {
              src: 'nfcWriteToken',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                token: context.token!,
              }),
              onDone: { target: 'waitingFinalization' },
              onError: {
                target: 'writeError',
                actions: assign({
                  error: ({ event }): PaymentError => ({
                    code: (event.error as { code?: string })?.code ?? 'WRITE_FAILED',
                    message:
                      event.error instanceof Error ? event.error.message : String(event.error),
                    recoverable: false,
                  }),
                }),
              },
            },
          },

          writeError: {
            always: [
              {
                guard: ({ context }) => !!context.operationId,
                target: 'rollingBack',
              },
              { target: '#payment.error' },
            ],
          },

          rollingBack: {
            invoke: {
              src: 'rollbackSend',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                operationId: context.operationId!,
                manager: context.manager!,
              }),
              onDone: { target: '#payment.error' },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ context }): PaymentError => ({
                    ...(context.error ?? {
                      code: 'ROLLBACK_FAILED',
                      message: 'Rollback failed',
                      recoverable: false,
                    }),
                    message:
                      (context.error?.message ?? 'Unknown error') + ' (rollback also failed)',
                  }),
                }),
              },
            },
          },

          waitingFinalization: {
            on: {
              FINALIZED: {
                target: '#payment.success',
                actions: assign({
                  historyEntry: ({ event }) => event.historyEntry,
                }),
              },
            },
          },
        },
      },

      // =================================================================
      // PAYMENT REQUEST SEND — Ecash token + Nostr DM (NUT-18)
      // =================================================================
      paymentRequestSending: {
        initial: 'sending',
        states: {
          sending: {
            invoke: {
              src: 'sendPaymentRequest',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                mintUrl: context.mintUrl!,
                amount: context.amount,
                manager: context.manager!,
                encodedPaymentRequest: context.encodedPaymentRequest!,
                unit: context.unit,
              }),
              onDone: {
                target: 'capturingLocation',
                actions: assign({
                  historyEntry: ({ event }) => event.output.historyEntry,
                  operationId: ({ event }) => event.output.operationId,
                }),
              },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('PAYMENT_REQUEST_SEND_FAILED', event.error),
                }),
              },
            },
          },

          capturingLocation: {
            invoke: {
              src: 'captureLocation',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                transactionId: context.historyEntry!.id,
              }),
              onDone: { target: '#payment.paymentRequestSent' },
              onError: { target: '#payment.paymentRequestSent' },
            },
          },
        },
      },

      // Terminal: payment request sent via Nostr DM
      paymentRequestSent: {
        type: 'final' as const,
        entry: ['hapticSuccess', 'popupPaymentRequestSent', 'onPaymentRequestSentCallback'],
      },

      // =================================================================
      // MINT QUOTE — Receive from Lightning (NEW)
      // =================================================================
      mintQuote: {
        initial: 'requestingInvoice',
        states: {
          requestingInvoice: {
            invoke: {
              src: 'requestLightningInvoice',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                mintUrl: context.mintUrl!,
                amount: context.amount,
                manager: context.manager!,
              }),
              onDone: {
                target: 'capturingLocation',
                actions: assign({
                  mintQuoteData: ({ event }) => event.output.mintQuote,
                  mintHistoryEntry: ({ event }) => event.output.historyEntry,
                }),
              },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('INVOICE_REQUEST_FAILED', event.error, true),
                }),
              },
            },
          },

          capturingLocation: {
            invoke: {
              src: 'captureLocation',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                transactionId: context.mintHistoryEntry!.id,
              }),
              onDone: { target: 'invoiceReady' },
              onError: { target: 'invoiceReady' },
            },
          },

          invoiceReady: {
            entry: 'onMintQuoteReadyCallback',
            invoke: {
              src: 'listenForMintQuotePayment',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                manager: context.manager,
                mintQuoteId:
                  (context.mintQuoteData as { quote?: string } | null)?.quote ?? null,
              }),
            },
            on: {
              PAYMENT_RECEIVED: {
                target: 'redeeming',
                actions: 'hapticSuccess',
              },
              QUOTE_EXPIRED: { target: '#payment.expired' },
              CANCEL: { target: '#payment.cancelled' },
            },
          },

          redeeming: {
            invoke: {
              src: 'redeemMintQuote',
              onDone: { target: '#payment.success' },
              onError: {
                target: '#payment.error',
                actions: assign({
                  error: ({ event }) => makeError('REDEEM_FAILED', event.error),
                }),
              },
            },
          },
        },
      },

      // =================================================================
      // ECASH RECEIVE — Token redemption branch
      // =================================================================
      ecashReceive: {
        initial: 'idle',
        states: {
          idle: {
            on: {
              REDEEM: [
                {
                  guard: ({ context }) => !context.manager,
                  target: '#payment.receiveError',
                  actions: assign({
                    error: (): PaymentError => ({
                      code: 'WALLET_NOT_READY',
                      message: 'Wallet not ready. Please try again.',
                      recoverable: true,
                    }),
                  }),
                },
                {
                  guard: ({ context }) => !context.tokenString,
                  target: '#payment.receiveError',
                  actions: assign({
                    error: (): PaymentError => ({
                      code: 'MISSING_TOKEN',
                      message: 'Missing token data.',
                      recoverable: false,
                    }),
                  }),
                },
                { target: 'redeeming' },
              ],
            },
          },

          redeeming: {
            entry: 'startReceiveEcash',
            invoke: {
              src: 'receiveEcash',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                tokenString: context.tokenString!,
                manager: context.manager!,
              }),
              onDone: {
                target: 'capturingLocation',
                actions: assign({
                  receiveHistoryEntry: ({ event }) => event.output,
                }),
              },
              onError: [
                {
                  guard: ({ event }) => {
                    const msg = (
                      event.error instanceof Error ? event.error.message : String(event.error)
                    ).toLowerCase();
                    return (
                      msg.includes('token already spent') ||
                      msg.includes('proof already spent') ||
                      msg.includes('already spent')
                    );
                  },
                  target: '#payment.alreadySpent',
                  actions: [
                    assign({
                      isAlreadySpent: true,
                      error: ({ event }) => makeError('ALREADY_SPENT', event.error, false),
                    }),
                    'errorReceiveEcash',
                  ],
                },
                {
                  target: '#payment.receiveError',
                  actions: [
                    assign({
                      error: ({ event }) => makeError('RECEIVE_FAILED', event.error, true),
                    }),
                    'errorReceiveEcash',
                  ],
                },
              ],
            },
          },

          capturingLocation: {
            invoke: {
              src: 'captureLocation',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                transactionId: context.receiveHistoryEntry!.id,
              }),
              onDone: { target: 'rotatingKey' },
              onError: { target: 'rotatingKey' },
            },
          },

          rotatingKey: {
            invoke: {
              src: 'rotateP2PKKey',
              input: ({ context }: { context: PaymentMachineContext }) => ({
                manager: context.manager!,
              }),
              onDone: { target: '#payment.receiveSuccess' },
              onError: { target: '#payment.receiveSuccess' },
            },
          },
        },
      },

      // =================================================================
      // TERMINAL STATES
      // =================================================================

      receiveSuccess: {
        type: 'final' as const,
        entry: ['hapticSuccess', 'linkReceiveTransaction'],
      },

      alreadySpent: {
        type: 'final' as const,
        entry: 'hapticError',
      },

      receiveError: {
        type: 'final' as const,
        entry: 'hapticError',
      },

      success: {
        type: 'final' as const,
        entry: ['hapticSuccess', 'linkTransaction', 'onSuccessCallback'],
      },

      cancelled: {
        type: 'final' as const,
        entry: 'onCancelledCallback',
      },

      expired: {
        type: 'final' as const,
      },

      error: {
        type: 'final' as const,
        entry: ['hapticError', 'onErrorCallback'],
      },
    },
  },
  {
    actors: {
      parsePaymentString: parsePaymentStringActor,
      sendEcash: sendEcashActor,
      rollbackSend: rollbackSendActor,
      captureLocation: captureLocationActor,
      getOfflineSuggestions: getOfflineSuggestionsActor,
      checkFiatOfflineOptimization: checkFiatOfflineOptimizationActor,
      resolveLnUrl: resolveLnUrlActor,
      prepareMeltQuote: prepareMeltQuoteActor,
      executeMeltQuote: executeMeltQuoteActor,
      rollbackMelt: rollbackMeltActor,
      selectBestMint: selectBestMintActor,
      requestCameraPermission: requestCameraPermissionActor,
      requestLightningInvoice: requestLightningInvoiceActor,
      redeemMintQuote: redeemMintQuoteActor,
      receiveEcash: receiveEcashActor,
      rotateP2PKKey: rotateP2PKKeyActor,
      nfcReadRequest: nfcReadRequestPlaceholder,
      nfcWriteToken: nfcWriteTokenPlaceholder,
      sendPaymentRequest: sendPaymentRequestPlaceholder,
      showOfflineSuggestionsPopup: fromCallback(() => {}),
      listenForMintQuotePayment: fromCallback(() => {}),
    },
    actions: {
      hapticSuccess: hapticSuccessAction,
      hapticError: hapticErrorAction,
      linkTransaction: linkTransactionAction,
      linkReceiveTransaction: linkReceiveTransactionAction,
      startReceiveEcash: receiveEcashStartAction,
      errorReceiveEcash: receiveEcashErrorAction,
      popupNoMint: noMintPopupAction,
      popupPaymentRequestSent: paymentRequestSentPopupAction,
      linkMeltTransaction: linkMeltTransactionAction,
      // Navigation actions — provided via .provide() in usePaymentMachine
      navigateToReceiveToken: () => {},
      navigateToLightning: () => {},
      navigateToMintUrl: () => {},
      navigateToNpub: () => {},
      navigateToPaymentRequest: () => {},
      navigateToLightningRedirect: () => {},
      // Outcome callbacks — provided via .provide() in usePaymentMachine
      onSuccessCallback: () => {},
      onErrorCallback: () => {},
      onCancelledCallback: () => {},
      onNoMintCallback: () => {},
      onInsufficientBalanceCallback: () => {},
      onPaymentRequestSentCallback: () => {},
      onMintQuoteReadyCallback: () => {},
    },
  }
);
