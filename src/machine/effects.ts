import { errAsync, okAsync, ResultAsync } from 'neverthrow';

import { isMintOfflineError } from '../errors';
import { t } from '../formatting/locales';
import { parseHistoryEntryOnce } from '../operations/historyEntry';
import { buildChooseProofsData, buildProofSuggestions } from './amountFallback';
import type {
  FlowContext,
  MachineOperations,
  MintQuoteMethod,
  NotificationHandlerMap,
  NfcIOAdapter,
  RecipientProfile,
  StepDataMap,
} from './types';

type TransactionCreatedNotificationData = Parameters<
  NonNullable<NotificationHandlerMap['onTransactionCreated']>
>[0];
type PaymentConfirmedNotificationData = Parameters<
  NonNullable<NotificationHandlerMap['onPaymentConfirmed']>
>[0];
type MeltQuoteCreatedNotificationData = Parameters<
  NonNullable<NotificationHandlerMap['onMeltQuoteCreated']>
>[0];
type NfcPaymentProgressNotificationData = Parameters<
  NonNullable<NotificationHandlerMap['onNfcPaymentProgress']>
>[0];
type NfcWriteFailedNotificationData = Parameters<
  NonNullable<NotificationHandlerMap['onNfcWriteFailed']>
>[0];

export type MachineEffectNotification =
  | {
      type: 'onPaymentConfirmed';
      data: PaymentConfirmedNotificationData;
    }
  | {
      type: 'onTransactionCreated';
      data: TransactionCreatedNotificationData;
    }
  | {
      type: 'onMeltQuoteCreated';
      data: MeltQuoteCreatedNotificationData;
    }
  | {
      type: 'onNfcWriteFailed';
      data: NfcWriteFailedNotificationData;
    };

export type MachineEffectLink = {
  type: 'linkTransaction';
  input: string;
  transactionId: string;
};

type SendOperation = MachineOperations['executeSend'];
type SendOperationResult = { historyEntry: string };
type NfcSendOperationResult = {
  token: string;
  historyEntry: string;
  operationId: string;
};
type MintListItems = NonNullable<StepDataMap['selectMint']['mintListItems']>;
type PaymentRequestOperationResult = {
  historyEntry: string;
  rolledBack?: boolean;
  errorMessage?: string;
};
type ConfirmSendEffectPath = 'localFirst' | 'online' | 'offlineFallback';
type ConfirmSendContextPatch = Partial<
  Pick<FlowContext, 'mintUnreachableConfirmed'>
>;

export type MintQuoteEffectSuccess =
  | {
      kind: 'completed';
      step: 'mintQuoteCreated';
      data: StepDataMap['mintQuoteCreated'];
      notifications: MachineEffectNotification[];
    }
  | { kind: 'stale' };

export type MintQuoteEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

export type ConfirmSendEffectSuccess =
  | {
      kind: 'completed';
      path: ConfirmSendEffectPath;
      step: 'sendComplete';
      data: StepDataMap['sendComplete'];
      context?: ConfirmSendContextPatch;
      notifications: MachineEffectNotification[];
    }
  | {
      kind: 'chooseProofs';
      step: 'chooseProofs';
      data: StepDataMap['chooseProofs'];
      context?: ConfirmSendContextPatch;
    }
  | {
      kind: 'stale';
      context?: ConfirmSendContextPatch;
    };

export type ConfirmSendEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
  context?: ConfirmSendContextPatch;
  fallbackFailure?: unknown;
};

export type ConfirmMeltEffectSuccess =
  | {
      kind: 'completed';
      step: 'navigateToMeltPreview';
      data: StepDataMap['navigateToMeltPreview'];
      links: MachineEffectLink[];
      notifications: MachineEffectNotification[];
    }
  | {
      kind: 'stale';
    };

export type ConfirmMeltEffectError = {
  kind: 'failed';
  cause: unknown;
};

export type ConfirmPaymentRequestEffectSuccess =
  | {
      kind: 'completed';
      step: 'navigateToPaymentRequest';
      data: StepDataMap['navigateToPaymentRequest'];
      links: MachineEffectLink[];
      notifications: MachineEffectNotification[];
    }
  | {
      kind: 'rolledBack';
      cause: Error;
      errorMessage?: string;
    }
  | {
      kind: 'stale';
    };

export type ConfirmPaymentRequestEffectError = {
  kind: 'failed';
  cause: unknown;
};

export type MintReviewInfoEffectSuccess =
  | {
      kind: 'completed';
      step: 'reviewMint';
      data: StepDataMap['reviewMint'];
    }
  | {
      kind: 'completed';
      step: 'openMint';
      data: StepDataMap['openMint'];
    }
  | {
      kind: 'stale';
    };

export type MintReviewInfoEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

export type TrustMintEffectSuccess =
  | {
      kind: 'completed';
    }
  | {
      kind: 'stale';
    };

export type TrustMintEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

export type MintListEnrichmentEffectSuccess =
  | {
      kind: 'completed';
      items: MintListItems;
    }
  | {
      kind: 'stale';
    };

export type MintListEnrichmentEffectError = {
  kind: 'failed';
  cause: unknown;
};

export type NfcWriteBackEffectSuccess =
  | {
      kind: 'completed';
      step: 'sendComplete';
      data: StepDataMap['sendComplete'];
      links: MachineEffectLink[];
      notifications: MachineEffectNotification[];
    }
  | {
      kind: 'stale';
    };

export type NfcWriteBackEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
  rolledBack: boolean;
  notifications: MachineEffectNotification[];
};

export type RecipientPubkeyEffectSuccess =
  | {
      kind: 'resolved';
      target: string;
      pubkey: string;
    }
  | {
      kind: 'empty';
      target: string;
    }
  | {
      kind: 'stale';
      target: string;
    };

export type RecipientPubkeyEffectError = {
  kind: 'failed';
  target: string;
  cause: unknown;
};

export type RecipientProfileEffectSuccess =
  | {
      kind: 'resolved';
      pubkey: string;
      profile: RecipientProfile;
    }
  | {
      kind: 'empty';
      pubkey: string;
    }
  | {
      kind: 'stale';
      pubkey: string;
    };

export type RecipientProfileEffectError = {
  kind: 'failed';
  pubkey: string;
  cause: unknown;
};

export interface RunMintQuoteEffectConfig {
  data: StepDataMap['createMintQuote'];
  operations: Pick<MachineOperations, 'executeMintQuote'>;
  context: FlowContext;
  getOffline: () => boolean;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

export interface RunConfirmSendEffectConfig {
  data: StepDataMap['confirmSend'];
  operations: Pick<MachineOperations, 'executeSend' | 'executeOfflineSend'>;
  context: FlowContext;
  proofAmounts: number[];
  getOffline: () => boolean;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

export interface RunConfirmMeltEffectConfig {
  data: StepDataMap['navigateToMeltPreview'];
  operation: NonNullable<MachineOperations['executeMelt']>;
  context: FlowContext;
  isStale: (op: string) => boolean;
}

export interface RunConfirmPaymentRequestEffectConfig {
  data: StepDataMap['navigateToPaymentRequest'];
  operation: NonNullable<MachineOperations['executePaymentRequest']>;
  context: FlowContext;
  isStale: (op: string) => boolean;
}

export interface RunMintReviewInfoEffectConfig {
  step: 'reviewMint' | 'openMint';
  data: StepDataMap['reviewMint'] | StepDataMap['openMint'];
  operation: NonNullable<MachineOperations['buildMintReviewInfo']>;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

export interface RunTrustMintEffectConfig {
  data: StepDataMap['reviewMint'];
  operation: NonNullable<MachineOperations['trustMint']>;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

export interface RunMintListEnrichmentEffectConfig {
  data: StepDataMap['selectMint'];
  operation: MachineOperations['buildMintListItems'];
  isStale: (op: string) => boolean;
}

export interface RunNfcWriteBackEffectConfig {
  data: StepDataMap['navigateToPaymentRequest'];
  executeNfcSend: NonNullable<MachineOperations['executeNfcSend']>;
  rollbackSend?: MachineOperations['rollbackSend'];
  nfcAdapter: Pick<NfcIOAdapter, 'writeToken' | 'releaseSession'>;
  context: FlowContext;
  onProgress?: (data: NfcPaymentProgressNotificationData) => void;
  isStale: (op: string) => boolean;
}

export interface RunRecipientPubkeyEffectConfig {
  target: string;
  operation: NonNullable<MachineOperations['resolveRecipientPubkey']>;
  isStale: (op: string) => boolean;
}

export interface RunRecipientProfileEffectConfig {
  pubkey: string;
  operation: NonNullable<MachineOperations['resolveRecipientProfile']>;
  isStale: (op: string) => boolean;
}

function toMintQuoteEffectError(
  cause: unknown,
  data: StepDataMap['createMintQuote'],
  locale: string,
): MintQuoteEffectError {
  const mintUnreachable = isMintOfflineError(cause);
  return {
    kind: 'failed',
    cause,
    data: {
      code: 'MINT_QUOTE_FAILED',
      message: mintUnreachable
        ? t('MINT_UNREACHABLE', locale)
        : cause instanceof Error
          ? cause.message
          : t('MINT_QUOTE_FAILED', locale),
      ...(mintUnreachable ? { data: { mintUnreachable: true } } : {}),
    },
  };
}

function toMintReviewInfoEffectError(
  cause: unknown,
  locale: string,
): MintReviewInfoEffectError {
  return {
    kind: 'failed',
    cause,
    data: {
      code: 'UNSUPPORTED_INPUT',
      message:
        cause instanceof Error ? cause.message : t('LOAD_MINTS_FAILED', locale),
    },
  };
}

function toTrustMintEffectError(
  cause: unknown,
  locale: string,
): TrustMintEffectError {
  return {
    kind: 'failed',
    cause,
    data: {
      code: 'UNSUPPORTED_INPUT',
      message:
        cause instanceof Error ? cause.message : t('TRUST_MINT_FAILED', locale),
    },
  };
}

function createOfflineMintQuoteError(locale: string): Error {
  const error = new Error(t('MINT_UNREACHABLE', locale));
  error.name = 'MintFetchError';
  return error;
}

function createOfflineSendError(locale: string): Error {
  const error = new Error(t('MINT_UNREACHABLE', locale));
  error.name = 'MintFetchError';
  return error;
}

function buildTransactionCreatedNotifications(args: {
  historyEntry: string;
  type: TransactionCreatedNotificationData['type'];
  mintUrl: string;
  amount: number;
  unit: string;
  context: FlowContext;
}): MachineEffectNotification[] {
  const parsed = parseHistoryEntryOnce(args.historyEntry);
  if (!parsed?.id) return [];

  return [
    {
      type: 'onTransactionCreated',
      data: {
        transactionId: parsed.id,
        type: args.type,
        mintUrl: args.mintUrl,
        amount: args.amount,
        unit: args.unit,
        rawInput: args.context.rawInput,
        source: args.context.source,
      },
    },
  ];
}

function buildMintQuoteNotifications(
  result: { historyEntry: string },
  data: StepDataMap['createMintQuote'],
  context: FlowContext,
): MachineEffectNotification[] {
  return buildTransactionCreatedNotifications({
    historyEntry: result.historyEntry,
    type: 'mint',
    mintUrl: data.mintUrl,
    amount: data.amount,
    unit: data.unit,
    context,
  });
}

function buildConfirmMeltResult(
  result: { historyEntry: string },
  data: StepDataMap['navigateToMeltPreview'],
  context: FlowContext,
): ConfirmMeltEffectSuccess {
  const parsed = parseHistoryEntryOnce(result.historyEntry);
  const links: MachineEffectLink[] = parsed?.id
    ? [
        {
          type: 'linkTransaction',
          input: data.meltTarget,
          transactionId: parsed.id,
        },
      ]
    : [];
  const notifications: MachineEffectNotification[] = [
    {
      type: 'onPaymentConfirmed',
      data: {
        variant: 'melt',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        historyEntry: result.historyEntry,
      },
    },
  ];

  if (parsed?.id) {
    notifications.push(
      {
        type: 'onTransactionCreated',
        data: {
          transactionId: parsed.id,
          type: 'melt',
          mintUrl: data.mintUrl,
          amount: data.amount,
          unit: data.unit,
          rawInput: context.rawInput,
          source: context.source,
        },
      },
      {
        type: 'onMeltQuoteCreated',
        data: {
          mintUrl: data.mintUrl,
          operationId: parsed.id,
          amount: data.amount,
          unit: data.unit,
          meltTarget: data.meltTarget,
        },
      },
    );
  }

  return {
    kind: 'completed',
    step: 'navigateToMeltPreview',
    data: { ...data, historyEntry: result.historyEntry },
    links,
    notifications,
  };
}

function buildConfirmPaymentRequestResult(
  result: PaymentRequestOperationResult,
  data: StepDataMap['navigateToPaymentRequest'],
  context: FlowContext,
): ConfirmPaymentRequestEffectSuccess {
  const parsed = parseHistoryEntryOnce(result.historyEntry);
  const links: MachineEffectLink[] = parsed?.id
    ? [
        {
          type: 'linkTransaction',
          input: data.paymentRequest,
          transactionId: parsed.id,
        },
      ]
    : [];
  const notifications: MachineEffectNotification[] = [
    {
      type: 'onPaymentConfirmed',
      data: {
        variant: 'paymentRequest',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        historyEntry: result.historyEntry,
      },
    },
  ];

  if (parsed?.id) {
    notifications.push({
      type: 'onTransactionCreated',
      data: {
        transactionId: parsed.id,
        type: 'send',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        rawInput: context.rawInput,
        source: context.source,
      },
    });
  }

  return {
    kind: 'completed',
    step: 'navigateToPaymentRequest',
    data: { ...data, historyEntry: result.historyEntry },
    links,
    notifications,
  };
}

function buildNfcWriteBackResult(
  result: NfcSendOperationResult,
  data: StepDataMap['navigateToPaymentRequest'],
  context: FlowContext,
): NfcWriteBackEffectSuccess {
  const parsed = parseHistoryEntryOnce(result.historyEntry);
  const links: MachineEffectLink[] =
    parsed?.id && context.rawInput
      ? [
          {
            type: 'linkTransaction',
            input: context.rawInput,
            transactionId: parsed.id,
          },
        ]
      : [];
  const notifications: MachineEffectNotification[] = [
    {
      type: 'onPaymentConfirmed',
      data: {
        variant: 'send',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        historyEntry: result.historyEntry,
      },
    },
  ];

  if (parsed?.id) {
    notifications.push({
      type: 'onTransactionCreated',
      data: {
        transactionId: parsed.id,
        type: 'send',
        mintUrl: data.mintUrl,
        amount: data.amount,
        unit: data.unit,
        rawInput: context.rawInput,
        source: 'nfc',
      },
    });
  }

  return {
    kind: 'completed',
    step: 'sendComplete',
    data: {
      historyEntry: result.historyEntry,
      recipientPubkey: context.recipientPubkey,
      recipientProfile: context.recipientProfile,
    },
    links,
    notifications,
  };
}

function buildNfcWriteBackError(args: {
  cause: unknown;
  rolledBack: boolean;
}): NfcWriteBackEffectError {
  const message =
    args.cause instanceof Error ? args.cause.message : 'NFC write failed';

  return {
    kind: 'failed',
    cause: args.cause,
    rolledBack: args.rolledBack,
    data: { code: 'NFC_WRITE_FAILED', message },
    notifications: [
      {
        type: 'onNfcWriteFailed',
        data: { message, rolledBack: args.rolledBack },
      },
    ],
  };
}

function buildSendCompleteResult(args: {
  path: ConfirmSendEffectPath;
  result: SendOperationResult;
  data: StepDataMap['confirmSend'];
  context: FlowContext;
  contextPatch?: ConfirmSendContextPatch;
  createdOffline: boolean;
  mintWasOffline: boolean;
}): ConfirmSendEffectSuccess {
  const effectiveContext = {
    ...args.context,
    ...args.contextPatch,
  };

  return {
    kind: 'completed',
    path: args.path,
    step: 'sendComplete',
    data: {
      historyEntry: args.result.historyEntry,
      ...(args.createdOffline ? { createdOffline: true } : {}),
      ...(args.mintWasOffline ? { mintWasOffline: true } : {}),
      recipientPubkey: effectiveContext.recipientPubkey,
      recipientProfile: effectiveContext.recipientProfile,
      ...(effectiveContext.p2pkLockPubkey
        ? { p2pkLockPubkey: effectiveContext.p2pkLockPubkey }
        : {}),
    },
    ...(args.contextPatch ? { context: args.contextPatch } : {}),
    notifications: buildTransactionCreatedNotifications({
      historyEntry: args.result.historyEntry,
      type: 'send',
      mintUrl: args.data.mintUrl,
      amount: args.data.amount,
      unit: effectiveContext.unit,
      context: effectiveContext,
    }),
  };
}

function executeSendOperation(
  operation: SendOperation,
  data: StepDataMap['confirmSend'],
  options?: { p2pkLockPubkey?: string },
): ResultAsync<SendOperationResult, unknown> {
  return ResultAsync.fromThrowable(
    () =>
      options?.p2pkLockPubkey
        ? operation(data.mintUrl, data.amount, data.memo, options)
        : data.memo
          ? operation(data.mintUrl, data.amount, data.memo)
          : operation(data.mintUrl, data.amount),
    (cause) => cause,
  )();
}

function toConfirmSendEffectError(args: {
  cause: unknown;
  locale: string;
  contextPatch?: ConfirmSendContextPatch;
  fallbackFailure?: unknown;
}): ConfirmSendEffectError {
  const mintUnreachable = isMintOfflineError(args.cause);
  return {
    kind: 'failed',
    cause: args.cause,
    data: {
      code: 'SEND_FAILED',
      message: mintUnreachable
        ? t('MINT_UNREACHABLE', args.locale)
        : args.cause instanceof Error
          ? args.cause.message
          : t('SEND_FAILED', args.locale),
      ...(mintUnreachable ? { data: { mintUnreachable: true } } : {}),
    },
    ...(args.contextPatch ? { context: args.contextPatch } : {}),
    ...(args.fallbackFailure ? { fallbackFailure: args.fallbackFailure } : {}),
  };
}

function buildMintUnreachableContextPatch(args: {
  cause: unknown;
  context: FlowContext;
  forceLocalSend: boolean;
  shouldCreateLocalTokenFirst: boolean;
}): ConfirmSendContextPatch | undefined {
  const mintUnreachableConfirmed =
    isMintOfflineError(args.cause) &&
    !args.forceLocalSend &&
    !args.shouldCreateLocalTokenFirst;

  if (!mintUnreachableConfirmed || args.context.mintUnreachableConfirmed)
    return undefined;

  return { mintUnreachableConfirmed: true };
}

function handleConfirmSendFailure(args: {
  cause: unknown;
  config: RunConfirmSendEffectConfig;
  locale: string;
  forceLocalSend: boolean;
  shouldCreateLocalTokenFirst: boolean;
}): ResultAsync<ConfirmSendEffectSuccess, ConfirmSendEffectError> {
  const { config } = args;
  if (config.isStale('executeSend.catch'))
    return okAsync({ kind: 'stale' } as const);

  const contextPatch = buildMintUnreachableContextPatch({
    cause: args.cause,
    context: config.context,
    forceLocalSend: args.forceLocalSend,
    shouldCreateLocalTokenFirst: args.shouldCreateLocalTokenFirst,
  });
  const effectiveContext = { ...config.context, ...contextPatch };

  // A locked send has no offline fallback and no local-proof rerouting —
  // both would produce a bearer token. Surface the original failure.
  if (config.context.p2pkLockPubkey) {
    return errAsync(
      toConfirmSendEffectError({
        cause: args.cause,
        locale: args.locale,
        contextPatch,
      }),
    );
  }

  if (
    isMintOfflineError(args.cause) &&
    config.operations.executeOfflineSend &&
    config.proofAmounts.length > 0
  ) {
    const built = buildProofSuggestions(
      config.proofAmounts,
      config.data.amount,
    );

    if (built.exactMatch) {
      return executeSendOperation(
        config.operations.executeOfflineSend,
        config.data,
      )
        .andThen((result) => {
          if (config.isStale('executeOfflineSend'))
            return okAsync({
              kind: 'stale',
              ...(contextPatch ? { context: contextPatch } : {}),
            } as const);

          return okAsync(
            buildSendCompleteResult({
              path: 'offlineFallback',
              result,
              data: config.data,
              context: config.context,
              contextPatch,
              createdOffline: true,
              mintWasOffline:
                contextPatch?.mintUnreachableConfirmed === true ||
                effectiveContext.mintUnreachableConfirmed === true,
            }),
          );
        })
        .orElse((fallbackFailure) => {
          if (config.isStale('executeOfflineSend.catch'))
            return okAsync({
              kind: 'stale',
              ...(contextPatch ? { context: contextPatch } : {}),
            } as const);

          return errAsync(
            toConfirmSendEffectError({
              cause: args.cause,
              locale: args.locale,
              contextPatch,
              fallbackFailure,
            }),
          );
        });
    }
  }

  if (config.proofAmounts.length > 0) {
    const built = buildProofSuggestions(
      config.proofAmounts,
      config.data.amount,
    );
    if (!built.exactMatch && built.hasSuggestion) {
      return okAsync({
        kind: 'chooseProofs' as const,
        step: 'chooseProofs' as const,
        data: buildChooseProofsData({
          mintUrl: config.data.mintUrl,
          amount: config.data.amount,
          unit: effectiveContext.unit,
          proofAmounts: config.proofAmounts,
          suggestions: built.suggestions,
          ctx: effectiveContext,
        }),
        ...(contextPatch ? { context: contextPatch } : {}),
      });
    }
  }

  return errAsync(
    toConfirmSendEffectError({
      cause: args.cause,
      locale: args.locale,
      contextPatch,
    }),
  );
}

export function runMintQuoteEffect({
  data,
  operations,
  context,
  getOffline,
  getLocale,
  isStale,
}: RunMintQuoteEffectConfig): ResultAsync<
  MintQuoteEffectSuccess,
  MintQuoteEffectError
> {
  const locale = getLocale();

  if (getOffline()) {
    return errAsync(
      toMintQuoteEffectError(createOfflineMintQuoteError(locale), data, locale),
    );
  }

  return ResultAsync.fromThrowable(
    () =>
      operations.executeMintQuote(
        data.mintUrl,
        data.amount,
        data.unit,
        data.method,
      ),
    (cause) => toMintQuoteEffectError(cause, data, locale),
  )()
    .andThen((result) => {
      if (isStale('executeMintQuote'))
        return okAsync({ kind: 'stale' } as const);
      return okAsync({
        kind: 'completed' as const,
        step: 'mintQuoteCreated' as const,
        data: { historyEntry: result.historyEntry, unit: data.unit },
        notifications: buildMintQuoteNotifications(result, data, context),
      });
    })
    .orElse((failure) => {
      if (isStale('executeMintQuote.catch'))
        return okAsync({ kind: 'stale' } as const);
      return errAsync(failure);
    });
}

export function runConfirmMeltEffect({
  data,
  operation,
  context,
  isStale,
}: RunConfirmMeltEffectConfig): ResultAsync<
  ConfirmMeltEffectSuccess,
  ConfirmMeltEffectError
> {
  return ResultAsync.fromThrowable(
    () => operation(data.mintUrl, data.meltTarget, data.amount, data.unit),
    (cause): ConfirmMeltEffectError => ({
      kind: 'failed',
      cause,
    }),
  )()
    .andThen((result) => {
      if (isStale('executeMelt')) return okAsync({ kind: 'stale' } as const);
      return okAsync(buildConfirmMeltResult(result, data, context));
    })
    .orElse((failure) => {
      if (isStale('executeMelt.catch'))
        return okAsync({ kind: 'stale' } as const);
      return errAsync(failure);
    });
}

export function runConfirmPaymentRequestEffect({
  data,
  operation,
  context,
  isStale,
}: RunConfirmPaymentRequestEffectConfig): ResultAsync<
  ConfirmPaymentRequestEffectSuccess,
  ConfirmPaymentRequestEffectError
> {
  return ResultAsync.fromThrowable(
    () => operation(data.mintUrl, data.paymentRequest, data.amount, data.unit),
    (cause): ConfirmPaymentRequestEffectError => ({
      kind: 'failed',
      cause,
    }),
  )()
    .andThen((result) => {
      if (isStale('executePaymentRequest'))
        return okAsync({ kind: 'stale' } as const);

      if (result.rolledBack) {
        return okAsync({
          kind: 'rolledBack' as const,
          cause: new Error(result.errorMessage ?? 'Delivery failed'),
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        });
      }

      return okAsync(buildConfirmPaymentRequestResult(result, data, context));
    })
    .orElse((failure) => {
      if (isStale('executePaymentRequest.catch'))
        return okAsync({ kind: 'stale' } as const);
      return errAsync(failure);
    });
}

export function runMintReviewInfoEffect({
  step,
  data,
  operation,
  getLocale,
  isStale,
}: RunMintReviewInfoEffectConfig): ResultAsync<
  MintReviewInfoEffectSuccess,
  MintReviewInfoEffectError
> {
  const locale = getLocale();
  const mintUrl =
    step === 'reviewMint'
      ? (data as StepDataMap['reviewMint']).mintUrl
      : (data as StepDataMap['openMint']).url;

  return ResultAsync.fromThrowable(
    () => operation(mintUrl),
    (cause) => toMintReviewInfoEffectError(cause, locale),
  )()
    .andThen((info) => {
      if (isStale('buildMintReviewInfo'))
        return okAsync({ kind: 'stale' } as const);

      if (step === 'reviewMint') {
        return okAsync({
          kind: 'completed' as const,
          step: 'reviewMint' as const,
          data: {
            ...(data as StepDataMap['reviewMint']),
            mintInfo: info,
          },
        });
      }

      return okAsync({
        kind: 'completed' as const,
        step: 'openMint' as const,
        data: {
          ...(data as StepDataMap['openMint']),
          mintInfo: info,
        },
      });
    })
    .orElse((failure) => {
      if (isStale('buildMintReviewInfo.catch'))
        return okAsync({ kind: 'stale' } as const);
      return errAsync(failure);
    });
}

export function runTrustMintEffect({
  data,
  operation,
  getLocale,
  isStale,
}: RunTrustMintEffectConfig): ResultAsync<
  TrustMintEffectSuccess,
  TrustMintEffectError
> {
  const locale = getLocale();

  return ResultAsync.fromThrowable(
    () => operation(data.mintUrl),
    (cause) => toTrustMintEffectError(cause, locale),
  )()
    .andThen(() => {
      if (isStale('trustMint')) return okAsync({ kind: 'stale' } as const);
      return okAsync({ kind: 'completed' } as const);
    })
    .orElse((failure) => {
      if (isStale('trustMint.catch'))
        return okAsync({ kind: 'stale' } as const);
      return errAsync(failure);
    });
}

export function runMintListEnrichmentEffect({
  data,
  operation,
  isStale,
}: RunMintListEnrichmentEffectConfig): ResultAsync<
  MintListEnrichmentEffectSuccess,
  MintListEnrichmentEffectError
> {
  return ResultAsync.fromThrowable(
    async () => {
      const items = await operation(data);
      if (isStale('buildMintListItems')) return { kind: 'stale' } as const;
      return { kind: 'completed' as const, items };
    },
    (cause): MintListEnrichmentEffectError => ({
      kind: 'failed',
      cause,
    }),
  )().orElse((failure) => {
    if (isStale('buildMintListItems.catch'))
      return okAsync({ kind: 'stale' } as const);
    return errAsync(failure);
  });
}

export function runNfcWriteBackEffect({
  data,
  executeNfcSend,
  rollbackSend,
  nfcAdapter,
  context,
  onProgress,
  isStale,
}: RunNfcWriteBackEffectConfig): ResultAsync<
  NfcWriteBackEffectSuccess,
  NfcWriteBackEffectError
> {
  return ResultAsync.fromPromise(
    (async () => {
      let nfcSendResult: NfcSendOperationResult | null = null;

      try {
        onProgress?.({ phase: 'creating' });
        nfcSendResult = await executeNfcSend(data.mintUrl, data.amount);
        if (isStale('executeNfcSend')) return { kind: 'stale' } as const;

        onProgress?.({ phase: 'writing' });
        await nfcAdapter.writeToken(nfcSendResult.token);
        if (isStale('nfc.writeToken')) return { kind: 'stale' } as const;

        await nfcAdapter.releaseSession();
        if (isStale('nfc.releaseSession')) return { kind: 'stale' } as const;

        return buildNfcWriteBackResult(nfcSendResult, data, context);
      } catch (cause) {
        if (isStale('executeNfcSend.catch')) {
          return { kind: 'stale' } as const;
        }

        let rolledBack = false;
        if (nfcSendResult && rollbackSend) {
          try {
            await rollbackSend(nfcSendResult.operationId);
            rolledBack = true;
          } catch {
            // Rollback is best-effort; the caller still needs the write failure.
          }
        }

        try {
          await nfcAdapter.releaseSession();
        } catch {
          // Release is idempotent and best-effort on the failure path.
        }

        throw buildNfcWriteBackError({ cause, rolledBack });
      }
    })(),
    (cause) => cause as NfcWriteBackEffectError,
  );
}

export function runRecipientPubkeyEffect({
  target,
  operation,
  isStale,
}: RunRecipientPubkeyEffectConfig): ResultAsync<
  RecipientPubkeyEffectSuccess,
  RecipientPubkeyEffectError
> {
  return ResultAsync.fromThrowable(
    async () => {
      const pubkey = await operation(target);
      if (isStale('resolveRecipientPubkey'))
        return { kind: 'stale' as const, target };
      if (!pubkey) return { kind: 'empty' as const, target };
      return { kind: 'resolved' as const, target, pubkey };
    },
    (cause): RecipientPubkeyEffectError => ({
      kind: 'failed',
      target,
      cause,
    }),
  )().orElse((failure) => {
    if (isStale('resolveRecipientPubkey.catch'))
      return okAsync({ kind: 'stale' as const, target });
    return errAsync(failure);
  });
}

export function runRecipientProfileEffect({
  pubkey,
  operation,
  isStale,
}: RunRecipientProfileEffectConfig): ResultAsync<
  RecipientProfileEffectSuccess,
  RecipientProfileEffectError
> {
  return ResultAsync.fromThrowable(
    async () => {
      const profile = await operation(pubkey);
      if (isStale('resolveRecipientProfile'))
        return { kind: 'stale' as const, pubkey };
      if (!profile) return { kind: 'empty' as const, pubkey };
      return { kind: 'resolved' as const, pubkey, profile };
    },
    (cause): RecipientProfileEffectError => ({
      kind: 'failed',
      pubkey,
      cause,
    }),
  )().orElse((failure) => {
    if (isStale('resolveRecipientProfile.catch'))
      return okAsync({ kind: 'stale' as const, pubkey });
    return errAsync(failure);
  });
}

export function runConfirmSendEffect({
  data,
  operations,
  context,
  proofAmounts,
  getOffline,
  getLocale,
  isStale,
}: RunConfirmSendEffectConfig): ResultAsync<
  ConfirmSendEffectSuccess,
  ConfirmSendEffectError
> {
  const locale = getLocale();
  // P2PK-locked sends require a mint swap (P2pkSendHandler always swaps) —
  // every local/offline token path would silently produce a bearer token
  // instead of a locked one, so all of them are disabled for locked sends.
  const p2pkLocked = !!context.p2pkLockPubkey;
  const localProofs = buildProofSuggestions(proofAmounts, data.amount);
  const hasExactLocalProofs = proofAmounts.length > 0 && localProofs.exactMatch;
  const shouldCreateLocalTokenFirst =
    hasExactLocalProofs && !p2pkLocked && !!operations.executeOfflineSend;
  const appOffline = getOffline() || context.offline === true;
  const forceLocalSend =
    !p2pkLocked && (appOffline || context.localProofSend === true);
  const config: RunConfirmSendEffectConfig = {
    data,
    operations,
    context,
    proofAmounts,
    getOffline,
    getLocale,
    isStale,
  };

  // Locked + offline fails fast: there is no offline shape of a locked send,
  // so don't even attempt the operation or any fallback routing.
  if (p2pkLocked && appOffline) {
    return errAsync({
      kind: 'failed',
      cause: createOfflineSendError(locale),
      data: {
        code: 'SEND_FAILED',
        message: t('MINT_UNREACHABLE', locale),
        data: { mintUnreachable: true, p2pkLocked: true },
      },
    } satisfies ConfirmSendEffectError);
  }

  if (shouldCreateLocalTokenFirst && operations.executeOfflineSend) {
    return executeSendOperation(operations.executeOfflineSend, data)
      .andThen((result) => {
        if (isStale('executeOfflineSend.localFirst'))
          return okAsync({ kind: 'stale' } as const);

        return okAsync(
          buildSendCompleteResult({
            path: 'localFirst',
            result,
            data,
            context,
            createdOffline: true,
            mintWasOffline: context.mintUnreachableConfirmed === true,
          }),
        );
      })
      .orElse((cause) =>
        handleConfirmSendFailure({
          cause,
          config,
          locale,
          forceLocalSend,
          shouldCreateLocalTokenFirst,
        }),
      );
  }

  if (forceLocalSend && operations.executeOfflineSend) {
    return handleConfirmSendFailure({
      cause: createOfflineSendError(locale),
      config,
      locale,
      forceLocalSend,
      shouldCreateLocalTokenFirst,
    });
  }

  return executeSendOperation(
    operations.executeSend,
    data,
    p2pkLocked ? { p2pkLockPubkey: context.p2pkLockPubkey } : undefined,
  )
    .andThen((result) => {
      if (isStale('executeSend')) return okAsync({ kind: 'stale' } as const);

      return okAsync(
        buildSendCompleteResult({
          path: 'online',
          result,
          data,
          context,
          createdOffline: false,
          mintWasOffline: false,
        }),
      );
    })
    .orElse((cause) =>
      handleConfirmSendFailure({
        cause,
        config,
        locale,
        forceLocalSend,
        shouldCreateLocalTokenFirst,
      }),
    );
}
