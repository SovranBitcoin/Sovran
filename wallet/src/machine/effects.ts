import { errAsync, okAsync, ResultAsync } from 'neverthrow';

import { isMintOfflineError } from '../errors';
import { t } from '../formatting/locales';
import { errField, logger, mintUrlFields } from '../logger';
import { parseHistoryEntryOnce } from '../operations/historyEntry';
import { buildChooseProofsData, buildProofSuggestions } from './amountFallback';
import type {
  FlowContext,
  MachineOperations,
  MeltQuotePreview,
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

type MachineEffectNotification =
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

type MachineEffectLink = {
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

type MintQuoteEffectSuccess =
  | {
      kind: 'completed';
      step: 'mintQuoteCreated';
      data: StepDataMap['mintQuoteCreated'];
      notifications: MachineEffectNotification[];
    }
  | { kind: 'stale' };

type MintQuoteEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

type PaymentRequestReceiveEffectSuccess =
  | {
      kind: 'completed';
      step: 'paymentRequestReceived';
      data: StepDataMap['paymentRequestReceived'];
    }
  | { kind: 'stale' };

type PaymentRequestReceiveEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

type ConfirmSendEffectSuccess =
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

type ConfirmSendEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
  context?: ConfirmSendContextPatch;
  fallbackFailure?: unknown;
};

type ConfirmMeltEffectSuccess =
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

type ConfirmMeltEffectError = {
  kind: 'failed';
  cause: unknown;
};

type MeltQuotePreviewEffectSuccess =
  | {
      kind: 'completed';
      quote: MeltQuotePreview;
    }
  | {
      kind: 'stale';
    };

type MeltQuotePreviewEffectError = {
  kind: 'failed';
  cause: unknown;
};

type ConfirmPaymentRequestEffectSuccess =
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

type ConfirmPaymentRequestEffectError = {
  kind: 'failed';
  cause: unknown;
};

type MintReviewInfoEffectSuccess =
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

type MintReviewInfoEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

type TrustMintEffectSuccess =
  | {
      kind: 'completed';
    }
  | {
      kind: 'stale';
    };

type TrustMintEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
};

type MintListEnrichmentEffectSuccess =
  | {
      kind: 'completed';
      items: MintListItems;
    }
  | {
      kind: 'stale';
    };

type MintListEnrichmentEffectError = {
  kind: 'failed';
  cause: unknown;
};

type NfcWriteBackEffectSuccess =
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

type NfcWriteBackEffectError = {
  kind: 'failed';
  cause: unknown;
  data: StepDataMap['error'];
  rolledBack: boolean;
  notifications: MachineEffectNotification[];
};

type RecipientPubkeyEffectSuccess =
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

type RecipientPubkeyEffectError = {
  kind: 'failed';
  target: string;
  cause: unknown;
};

type RecipientProfileEffectSuccess =
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

type RecipientProfileEffectError = {
  kind: 'failed';
  pubkey: string;
  cause: unknown;
};

interface RunMintQuoteEffectConfig {
  data: StepDataMap['createMintQuote'];
  operations: Pick<MachineOperations, 'executeMintQuote'>;
  context: FlowContext;
  getOffline: () => boolean;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

interface RunPaymentRequestReceiveEffectConfig {
  data: StepDataMap['createPaymentRequestReceive'];
  operations: Pick<MachineOperations, 'createPaymentRequestReceive'>;
  isStale: (op: string) => boolean;
}

interface RunConfirmSendEffectConfig {
  data: StepDataMap['confirmSend'];
  operations: Pick<MachineOperations, 'executeSend' | 'executeOfflineSend'>;
  context: FlowContext;
  proofAmounts: number[];
  getOffline: () => boolean;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

interface RunConfirmMeltEffectConfig {
  data: StepDataMap['navigateToMeltPreview'];
  operation: NonNullable<MachineOperations['executeMelt']>;
  context: FlowContext;
  isStale: (op: string) => boolean;
}

interface RunMeltQuotePreviewEffectConfig {
  data: StepDataMap['navigateToMeltPreview'];
  operation: NonNullable<MachineOperations['quoteMelt']>;
  isStale: (op: string) => boolean;
}

interface RunConfirmPaymentRequestEffectConfig {
  data: StepDataMap['navigateToPaymentRequest'];
  operation: NonNullable<MachineOperations['executePaymentRequest']>;
  context: FlowContext;
  isStale: (op: string) => boolean;
}

interface RunMintReviewInfoEffectConfig {
  step: 'reviewMint' | 'openMint';
  data: StepDataMap['reviewMint'] | StepDataMap['openMint'];
  operation: NonNullable<MachineOperations['buildMintReviewInfo']>;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

interface RunTrustMintEffectConfig {
  data: StepDataMap['reviewMint'];
  operation: NonNullable<MachineOperations['trustMint']>;
  getLocale: () => string;
  isStale: (op: string) => boolean;
}

interface RunMintListEnrichmentEffectConfig {
  data: StepDataMap['selectMint'];
  operation: MachineOperations['buildMintListItems'];
  isStale: (op: string) => boolean;
}

interface RunNfcWriteBackEffectConfig {
  data: StepDataMap['navigateToPaymentRequest'];
  executeNfcSend: NonNullable<MachineOperations['executeNfcSend']>;
  rollbackSend?: MachineOperations['rollbackSend'];
  nfcAdapter: Pick<NfcIOAdapter, 'writeToken' | 'releaseSession'>;
  context: FlowContext;
  onProgress?: (data: NfcPaymentProgressNotificationData) => void;
  isStale: (op: string) => boolean;
}

interface RunRecipientPubkeyEffectConfig {
  target: string;
  operation: NonNullable<MachineOperations['resolveRecipientPubkey']>;
  isStale: (op: string) => boolean;
}

interface RunRecipientProfileEffectConfig {
  pubkey: string;
  operation: NonNullable<MachineOperations['resolveRecipientProfile']>;
  isStale: (op: string) => boolean;
}

function summarizeContext(context: FlowContext): Record<string, unknown> {
  return {
    destination: context.destination ?? null,
    unit: context.unit,
    offline: context.offline === true,
    localProofSend: context.localProofSend === true,
    mintUnreachableConfirmed: context.mintUnreachableConfirmed === true,
    hasPaymentRequest: !!context.paymentRequest,
    paymentRequestLength: context.paymentRequest?.length ?? 0,
    hasMeltTarget: !!context.meltTarget,
    meltTargetLength: context.meltTarget?.length ?? 0,
    hasRecipientPubkey: !!context.recipientPubkey,
    hasRecipientProfile: !!context.recipientProfile,
    hasP2pkLockPubkey: !!context.p2pkLockPubkey,
    p2pkLockPubkeyLength: context.p2pkLockPubkey?.length ?? 0,
    hasMemo: !!context.memo,
    rawInputLength: context.rawInput?.length ?? 0,
    source: context.source ?? null,
  };
}

function summarizeNotifications(
  notifications: MachineEffectNotification[],
): Record<string, unknown> {
  const byType: Record<string, number> = {};
  const paymentVariants: string[] = [];

  for (const notification of notifications) {
    byType[notification.type] = (byType[notification.type] ?? 0) + 1;
    if (notification.type === 'onPaymentConfirmed') {
      paymentVariants.push(notification.data.variant);
    }
  }

  return {
    count: notifications.length,
    byType,
    paymentVariants,
  };
}

function summarizeLinks(links: MachineEffectLink[]): Record<string, unknown> {
  return {
    count: links.length,
    linkTypes: links.map((link) => link.type),
    withInputCount: links.filter((link) => link.input.length > 0).length,
    transactionIdPresentCount: links.filter(
      (link) => link.transactionId.length > 0,
    ).length,
  };
}

function summarizeHistoryEntry(historyEntry: string): Record<string, unknown> {
  const parsed = parseHistoryEntryOnce(historyEntry);
  return {
    historyEntryLength: historyEntry.length,
    transactionIdPresent: !!parsed?.id,
  };
}

function toMintQuoteEffectError(
  cause: unknown,
  data: StepDataMap['createMintQuote'],
  locale: string,
): MintQuoteEffectError {
  const mintUnreachable = isMintOfflineError(cause);
  logger.warn('effects.mintQuote.error', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    method: data.method ?? 'bolt11',
    mintUnreachable,
    error: errField(cause),
  });
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
  logger.warn('effects.mintReviewInfo.error', {
    error: errField(cause),
  });
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
  logger.warn('effects.trustMint.error', {
    error: errField(cause),
  });
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
  logger.info('effects.mintQuote.offlineBlocked');
  return error;
}

function createOfflineSendError(locale: string): Error {
  const error = new Error(t('MINT_UNREACHABLE', locale));
  error.name = 'MintFetchError';
  logger.info('effects.send.offlineErrorCreated');
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
  if (!parsed?.id) {
    logger.warn('effects.transactionNotification.skipped', {
      reason: 'missing_transaction_id',
      type: args.type,
      ...mintUrlFields(args.mintUrl),
      amount: args.amount,
      unit: args.unit,
      historyEntryLength: args.historyEntry.length,
      rawInputLength: args.context.rawInput?.length ?? 0,
      source: args.context.source ?? null,
    });
    return [];
  }

  logger.info('effects.transactionNotification.created', {
    type: args.type,
    ...mintUrlFields(args.mintUrl),
    amount: args.amount,
    unit: args.unit,
    historyEntryLength: args.historyEntry.length,
    transactionIdPresent: true,
    rawInputLength: args.context.rawInput?.length ?? 0,
    source: args.context.source ?? null,
  });

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

  logger.info('effects.confirmMelt.result', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    meltTargetLength: data.meltTarget.length,
    ...summarizeHistoryEntry(result.historyEntry),
    links: summarizeLinks(links),
    notifications: summarizeNotifications(notifications),
    context: summarizeContext(context),
  });

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

  logger.info('effects.paymentRequest.result', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    paymentRequestLength: data.paymentRequest.length,
    ...summarizeHistoryEntry(result.historyEntry),
    links: summarizeLinks(links),
    notifications: summarizeNotifications(notifications),
    context: summarizeContext(context),
  });

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

  logger.info('effects.nfcWriteBack.result', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    operationIdPresent: result.operationId.length > 0,
    ...summarizeHistoryEntry(result.historyEntry),
    links: summarizeLinks(links),
    notifications: summarizeNotifications(notifications),
    context: summarizeContext(context),
  });

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

  logger.warn('effects.nfcWriteBack.error', {
    rolledBack: args.rolledBack,
    error: errField(args.cause),
  });

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
  const notifications = buildTransactionCreatedNotifications({
    historyEntry: args.result.historyEntry,
    type: 'send',
    mintUrl: args.data.mintUrl,
    amount: args.data.amount,
    unit: effectiveContext.unit,
    context: effectiveContext,
  });

  logger.info('effects.sendComplete.result', {
    path: args.path,
    ...mintUrlFields(args.data.mintUrl),
    amount: args.data.amount,
    unit: effectiveContext.unit,
    createdOffline: args.createdOffline,
    mintWasOffline: args.mintWasOffline,
    contextPatched: !!args.contextPatch,
    ...summarizeHistoryEntry(args.result.historyEntry),
    notifications: summarizeNotifications(notifications),
    context: summarizeContext(effectiveContext),
  });

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
    notifications,
  };
}

function executeSendOperation(
  operation: SendOperation,
  data: StepDataMap['confirmSend'],
  options?: { p2pkLockPubkey?: string },
  path: ConfirmSendEffectPath | 'forcedLocalProbe' = 'online',
): ResultAsync<SendOperationResult, unknown> {
  logger.info('effects.sendOperation.start', {
    path,
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    hasMemo: !!data.memo,
    p2pkLocked: !!options?.p2pkLockPubkey,
    p2pkLockPubkeyLength: options?.p2pkLockPubkey?.length ?? 0,
  });

  return ResultAsync.fromThrowable(
    () =>
      options?.p2pkLockPubkey
        ? operation(data.mintUrl, data.amount, data.memo, options)
        : data.memo
          ? operation(data.mintUrl, data.amount, data.memo)
          : operation(data.mintUrl, data.amount),
    (cause) => {
      logger.warn('effects.sendOperation.threw', {
        path,
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        p2pkLocked: !!options?.p2pkLockPubkey,
        error: errField(cause),
      });
      return cause;
    },
  )();
}

function toConfirmSendEffectError(args: {
  cause: unknown;
  locale: string;
  contextPatch?: ConfirmSendContextPatch;
  fallbackFailure?: unknown;
}): ConfirmSendEffectError {
  const mintUnreachable = isMintOfflineError(args.cause);
  logger.warn('effects.confirmSend.error', {
    mintUnreachable,
    contextPatched: !!args.contextPatch,
    fallbackFailed: !!args.fallbackFailure,
    error: errField(args.cause),
    fallbackError: args.fallbackFailure
      ? errField(args.fallbackFailure)
      : undefined,
  });
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

  if (!mintUnreachableConfirmed || args.context.mintUnreachableConfirmed) {
    logger.debug('effects.mintUnreachablePatch.skipped', {
      mintUnreachableConfirmed,
      alreadyConfirmed: args.context.mintUnreachableConfirmed === true,
      forceLocalSend: args.forceLocalSend,
      shouldCreateLocalTokenFirst: args.shouldCreateLocalTokenFirst,
    });
    return undefined;
  }

  logger.info('effects.mintUnreachablePatch.created', {
    forceLocalSend: args.forceLocalSend,
    shouldCreateLocalTokenFirst: args.shouldCreateLocalTokenFirst,
  });
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
  logger.warn('effects.confirmSend.failure', {
    ...mintUrlFields(config.data.mintUrl),
    amount: config.data.amount,
    forceLocalSend: args.forceLocalSend,
    shouldCreateLocalTokenFirst: args.shouldCreateLocalTokenFirst,
    proofCount: config.proofAmounts.length,
    p2pkLocked: !!config.context.p2pkLockPubkey,
    mintUnreachable: isMintOfflineError(args.cause),
    error: errField(args.cause),
  });

  if (config.isStale('executeSend.catch')) {
    logger.info('effects.confirmSend.stale', { op: 'executeSend.catch' });
    return okAsync({ kind: 'stale' } as const);
  }

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
    logger.warn('effects.confirmSend.failure.p2pkLockedNoFallback', {
      ...mintUrlFields(config.data.mintUrl),
      amount: config.data.amount,
      mintUnreachable: isMintOfflineError(args.cause),
      contextPatched: !!contextPatch,
    });
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
    logger.info('effects.confirmSend.offlineFallback.considered', {
      ...mintUrlFields(config.data.mintUrl),
      amount: config.data.amount,
      proofCount: config.proofAmounts.length,
      exactMatch: built.exactMatch,
      hasSuggestion: built.hasSuggestion,
    });

    if (built.exactMatch) {
      return executeSendOperation(
        config.operations.executeOfflineSend,
        config.data,
        undefined,
        'offlineFallback',
      )
        .andThen((result) => {
          if (config.isStale('executeOfflineSend')) {
            logger.info('effects.confirmSend.stale', {
              op: 'executeOfflineSend',
              path: 'offlineFallback',
            });
            return okAsync({
              kind: 'stale',
              ...(contextPatch ? { context: contextPatch } : {}),
            } as const);
          }

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
          if (config.isStale('executeOfflineSend.catch')) {
            logger.info('effects.confirmSend.stale', {
              op: 'executeOfflineSend.catch',
              path: 'offlineFallback',
            });
            return okAsync({
              kind: 'stale',
              ...(contextPatch ? { context: contextPatch } : {}),
            } as const);
          }

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
      logger.info('effects.confirmSend.chooseProofs', {
        ...mintUrlFields(config.data.mintUrl),
        amount: config.data.amount,
        unit: effectiveContext.unit,
        proofCount: config.proofAmounts.length,
        contextPatched: !!contextPatch,
      });
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

  logger.info('effects.mintQuote.start', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    method: data.method ?? 'bolt11',
    offline: getOffline(),
    context: summarizeContext(context),
  });

  if (getOffline()) {
    logger.warn('effects.mintQuote.blocked', {
      reason: 'offline',
      ...mintUrlFields(data.mintUrl),
      amount: data.amount,
      unit: data.unit,
    });
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
      if (isStale('executeMintQuote')) {
        logger.info('effects.mintQuote.stale', { op: 'executeMintQuote' });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.info('effects.mintQuote.completed', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        method: data.method ?? 'bolt11',
        ...summarizeHistoryEntry(result.historyEntry),
      });
      return okAsync({
        kind: 'completed' as const,
        step: 'mintQuoteCreated' as const,
        data: { historyEntry: result.historyEntry, unit: data.unit },
        notifications: buildMintQuoteNotifications(result, data, context),
      });
    })
    .orElse((failure) => {
      if (isStale('executeMintQuote.catch')) {
        logger.info('effects.mintQuote.stale', {
          op: 'executeMintQuote.catch',
        });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.warn('effects.mintQuote.failed', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        method: data.method ?? 'bolt11',
        error: errField(failure.cause),
      });
      return errAsync(failure);
    });
}

/**
 * Auto-execution for receive "as Ecash": create a single-use NUT-18 request
 * via the durable coco operation and re-target to `paymentRequestReceived`
 * with the encoded payload. Mirrors `runMintQuoteEffect` — the app's step
 * handler navigates off the resulting step, so delivery never depends on a
 * side-channel navigation callback.
 */
export function runPaymentRequestReceiveEffect({
  data,
  operations,
  isStale,
}: RunPaymentRequestReceiveEffectConfig): ResultAsync<
  PaymentRequestReceiveEffectSuccess,
  PaymentRequestReceiveEffectError
> {
  logger.info('effects.paymentRequestReceive.start', {
    amount: data.amount,
    unit: data.unit,
  });

  const create = operations.createPaymentRequestReceive;
  if (!create) {
    logger.warn('effects.paymentRequestReceive.unsupported');
    return errAsync({
      kind: 'failed',
      cause: new Error('createPaymentRequestReceive operation is unavailable'),
      data: {
        code: 'PAYMENT_REQUEST_FAILED',
        message: 'Receiving as ecash is not available.',
      },
    });
  }

  return ResultAsync.fromThrowable(
    () => create({ amount: data.amount, unit: data.unit }),
    (cause): PaymentRequestReceiveEffectError => {
      logger.warn('effects.paymentRequestReceive.threw', {
        amount: data.amount,
        unit: data.unit,
        error: errField(cause),
      });
      return {
        kind: 'failed',
        cause,
        data: {
          code: 'PAYMENT_REQUEST_FAILED',
          message:
            cause instanceof Error
              ? cause.message
              : 'Could not create the ecash request.',
        },
      };
    },
  )()
    .andThen((created) => {
      if (isStale('createPaymentRequestReceive')) {
        logger.info('effects.paymentRequestReceive.stale');
        return okAsync({ kind: 'stale' } as const);
      }
      logger.info('effects.paymentRequestReceive.completed', {
        operationId: created.operationId,
        amount: created.amount,
        unit: created.unit,
        encodedLength: created.encodedRequest.length,
      });
      return okAsync({
        kind: 'completed' as const,
        step: 'paymentRequestReceived' as const,
        data: { entry: JSON.stringify(created), unit: created.unit },
      });
    })
    .orElse((failure) => {
      if (isStale('createPaymentRequestReceive.catch')) {
        logger.info('effects.paymentRequestReceive.stale', {
          op: 'createPaymentRequestReceive.catch',
        });
        return okAsync({ kind: 'stale' } as const);
      }
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
  logger.info('effects.confirmMelt.start', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    meltTargetLength: data.meltTarget.length,
    hasPrecreatedQuote: !!data.meltQuote,
    context: summarizeContext(context),
  });

  return ResultAsync.fromThrowable(
    // No 5th argument when no pre-created quote exists — legacy callers
    // (and their call-shape assertions) keep the exact 4-argument form.
    () =>
      data.meltQuote
        ? operation(data.mintUrl, data.meltTarget, data.amount, data.unit, {
            quoteId: data.meltQuote.quoteId,
          })
        : operation(data.mintUrl, data.meltTarget, data.amount, data.unit),
    (cause): ConfirmMeltEffectError => {
      logger.warn('effects.confirmMelt.threw', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        error: errField(cause),
      });
      return {
        kind: 'failed',
        cause,
      };
    },
  )()
    .andThen((result) => {
      if (isStale('executeMelt')) {
        logger.info('effects.confirmMelt.stale', { op: 'executeMelt' });
        return okAsync({ kind: 'stale' } as const);
      }
      return okAsync(buildConfirmMeltResult(result, data, context));
    })
    .orElse((failure) => {
      if (isStale('executeMelt.catch')) {
        logger.info('effects.confirmMelt.stale', { op: 'executeMelt.catch' });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.warn('effects.confirmMelt.failed', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        error: errField(failure.cause),
      });
      return errAsync(failure);
    });
}

/**
 * Create the melt quote for the preview screen (BTC-05 quote-first). The
 * quote's `fee_reserve` and mint-quoted amount are what the confirm screen
 * displays; `confirmMelt` later executes against the same quote. Best-effort
 * by contract of the caller: a failure must NOT block navigation — the
 * preview degrades to today's pay-then-quote shape instead.
 */
export function runMeltQuotePreviewEffect({
  data,
  operation,
  isStale,
}: RunMeltQuotePreviewEffectConfig): ResultAsync<
  MeltQuotePreviewEffectSuccess,
  MeltQuotePreviewEffectError
> {
  logger.info('effects.meltQuotePreview.start', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    meltTargetLength: data.meltTarget.length,
  });

  return ResultAsync.fromThrowable(
    () => operation(data.mintUrl, data.meltTarget, data.amount, data.unit),
    (cause): MeltQuotePreviewEffectError => {
      logger.warn('effects.meltQuotePreview.threw', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        error: errField(cause),
      });
      return { kind: 'failed', cause };
    },
  )()
    .andThen((quote) => {
      if (isStale('quoteMelt')) {
        logger.info('effects.meltQuotePreview.stale', { op: 'quoteMelt' });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.info('effects.meltQuotePreview.completed', {
        ...mintUrlFields(data.mintUrl),
        quoteId: quote.quoteId,
        quoteAmount: quote.quoteAmount,
        feeReserve: quote.feeReserve,
        unit: quote.unit,
        method: quote.method,
      });
      return okAsync({ kind: 'completed' as const, quote });
    })
    .orElse((failure) => {
      if (isStale('quoteMelt.catch')) {
        logger.info('effects.meltQuotePreview.stale', { op: 'quoteMelt.catch' });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.warn('effects.meltQuotePreview.failed', {
        ...mintUrlFields(data.mintUrl),
        error: errField(failure.cause),
      });
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
  logger.info('effects.paymentRequest.start', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    paymentRequestLength: data.paymentRequest.length,
    context: summarizeContext(context),
  });

  return ResultAsync.fromThrowable(
    () => operation(data.mintUrl, data.paymentRequest, data.amount, data.unit),
    (cause): ConfirmPaymentRequestEffectError => {
      logger.warn('effects.paymentRequest.threw', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        error: errField(cause),
      });
      return {
        kind: 'failed',
        cause,
      };
    },
  )()
    .andThen((result) => {
      if (isStale('executePaymentRequest')) {
        logger.info('effects.paymentRequest.stale', {
          op: 'executePaymentRequest',
        });
        return okAsync({ kind: 'stale' } as const);
      }

      if (result.rolledBack) {
        logger.warn('effects.paymentRequest.rolledBack', {
          ...mintUrlFields(data.mintUrl),
          amount: data.amount,
          unit: data.unit,
          hasErrorMessage: !!result.errorMessage,
          ...summarizeHistoryEntry(result.historyEntry),
        });
        return okAsync({
          kind: 'rolledBack' as const,
          cause: new Error(result.errorMessage ?? 'Delivery failed'),
          ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
        });
      }

      return okAsync(buildConfirmPaymentRequestResult(result, data, context));
    })
    .orElse((failure) => {
      if (isStale('executePaymentRequest.catch')) {
        logger.info('effects.paymentRequest.stale', {
          op: 'executePaymentRequest.catch',
        });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.warn('effects.paymentRequest.failed', {
        ...mintUrlFields(data.mintUrl),
        amount: data.amount,
        unit: data.unit,
        error: errField(failure.cause),
      });
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

  logger.info('effects.mintReviewInfo.start', {
    step,
    ...mintUrlFields(mintUrl),
    hasReviewToken: step === 'reviewMint',
  });

  return ResultAsync.fromThrowable(
    () => operation(mintUrl),
    (cause) => toMintReviewInfoEffectError(cause, locale),
  )()
    .andThen((info) => {
      if (isStale('buildMintReviewInfo')) {
        logger.info('effects.mintReviewInfo.stale', {
          op: 'buildMintReviewInfo',
          step,
          ...mintUrlFields(mintUrl),
        });
        return okAsync({ kind: 'stale' } as const);
      }

      logger.info('effects.mintReviewInfo.completed', {
        step,
        ...mintUrlFields(mintUrl),
        hasMintInfo: !!info,
      });

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
      if (isStale('buildMintReviewInfo.catch')) {
        logger.info('effects.mintReviewInfo.stale', {
          op: 'buildMintReviewInfo.catch',
          step,
          ...mintUrlFields(mintUrl),
        });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.warn('effects.mintReviewInfo.failed', {
        step,
        ...mintUrlFields(mintUrl),
        error: errField(failure.cause),
      });
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

  logger.info('effects.trustMint.start', {
    ...mintUrlFields(data.mintUrl),
  });

  return ResultAsync.fromThrowable(
    () => operation(data.mintUrl),
    (cause) => toTrustMintEffectError(cause, locale),
  )()
    .andThen(() => {
      if (isStale('trustMint')) {
        logger.info('effects.trustMint.stale', { op: 'trustMint' });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.info('effects.trustMint.completed', { ...mintUrlFields(data.mintUrl) });
      return okAsync({ kind: 'completed' } as const);
    })
    .orElse((failure) => {
      if (isStale('trustMint.catch')) {
        logger.info('effects.trustMint.stale', { op: 'trustMint.catch' });
        return okAsync({ kind: 'stale' } as const);
      }
      logger.warn('effects.trustMint.failed', {
        ...mintUrlFields(data.mintUrl),
        error: errField(failure.cause),
      });
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
  logger.info('effects.mintListEnrichment.start', {
    candidateCount: data.candidates.length,
    supportedMintCount: data.supportedMintUrls?.length ?? 0,
    amount: data.amount ?? null,
    unit: data.unit,
    destination: data.destination ?? null,
    scope: data.scope ?? 'selected',
    mintListItemsStatus: data.mintListItemsStatus ?? null,
  });

  return ResultAsync.fromThrowable(
    async () => {
      const items = await operation(data);
      if (isStale('buildMintListItems')) {
        logger.info('effects.mintListEnrichment.stale', {
          op: 'buildMintListItems',
          itemCount: items.length,
        });
        return { kind: 'stale' } as const;
      }
      logger.info('effects.mintListEnrichment.completed', {
        itemCount: items.length,
        candidateCount: data.candidates.length,
      });
      return { kind: 'completed' as const, items };
    },
    (cause): MintListEnrichmentEffectError => {
      logger.warn('effects.mintListEnrichment.threw', {
        candidateCount: data.candidates.length,
        error: errField(cause),
      });
      return {
        kind: 'failed',
        cause,
      };
    },
  )().orElse((failure) => {
    if (isStale('buildMintListItems.catch')) {
      logger.info('effects.mintListEnrichment.stale', {
        op: 'buildMintListItems.catch',
      });
      return okAsync({ kind: 'stale' } as const);
    }
    logger.warn('effects.mintListEnrichment.failed', {
      candidateCount: data.candidates.length,
      error: errField(failure.cause),
    });
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
  logger.info('effects.nfcWriteBack.start', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: data.unit,
    paymentRequestLength: data.paymentRequest.length,
    hasRollback: !!rollbackSend,
    context: summarizeContext(context),
  });

  return ResultAsync.fromPromise(
    (async () => {
      let nfcSendResult: NfcSendOperationResult | null = null;

      try {
        logger.info('effects.nfcWriteBack.progress', { phase: 'creating' });
        onProgress?.({ phase: 'creating' });
        nfcSendResult = await executeNfcSend(data.mintUrl, data.amount);
        logger.info('effects.nfcWriteBack.tokenCreated', {
          operationIdPresent: nfcSendResult.operationId.length > 0,
          ...summarizeHistoryEntry(nfcSendResult.historyEntry),
        });
        if (isStale('executeNfcSend')) {
          logger.info('effects.nfcWriteBack.stale', { op: 'executeNfcSend' });
          return { kind: 'stale' } as const;
        }

        logger.info('effects.nfcWriteBack.progress', { phase: 'writing' });
        onProgress?.({ phase: 'writing' });
        await nfcAdapter.writeToken(nfcSendResult.token);
        if (isStale('nfc.writeToken')) {
          logger.info('effects.nfcWriteBack.stale', { op: 'nfc.writeToken' });
          return { kind: 'stale' } as const;
        }

        await nfcAdapter.releaseSession();
        if (isStale('nfc.releaseSession')) {
          logger.info('effects.nfcWriteBack.stale', {
            op: 'nfc.releaseSession',
          });
          return { kind: 'stale' } as const;
        }

        return buildNfcWriteBackResult(nfcSendResult, data, context);
      } catch (cause) {
        if (isStale('executeNfcSend.catch')) {
          logger.info('effects.nfcWriteBack.stale', {
            op: 'executeNfcSend.catch',
          });
          return { kind: 'stale' } as const;
        }

        logger.warn('effects.nfcWriteBack.failed', {
          hasPreparedSend: !!nfcSendResult,
          hasRollback: !!rollbackSend,
          error: errField(cause),
        });

        let rolledBack = false;
        if (nfcSendResult && rollbackSend) {
          try {
            await rollbackSend(nfcSendResult.operationId);
            rolledBack = true;
            logger.info('effects.nfcWriteBack.rollback.completed', {
              operationIdPresent: nfcSendResult.operationId.length > 0,
            });
          } catch (rollbackErr) {
            logger.warn('effects.nfcWriteBack.rollback.failed', {
              operationIdPresent: nfcSendResult.operationId.length > 0,
              error: errField(rollbackErr),
            });
            // Rollback is best-effort; the caller still needs the write failure.
          }
        }

        try {
          await nfcAdapter.releaseSession();
          logger.info('effects.nfcWriteBack.release.completed', {
            failurePath: true,
          });
        } catch (releaseErr) {
          logger.warn('effects.nfcWriteBack.release.failed', {
            error: errField(releaseErr),
          });
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
  logger.info('effects.recipientPubkey.start', {
    targetLength: target.length,
  });

  return ResultAsync.fromThrowable(
    async () => {
      const pubkey = await operation(target);
      if (isStale('resolveRecipientPubkey')) {
        logger.info('effects.recipientPubkey.stale', {
          op: 'resolveRecipientPubkey',
          targetLength: target.length,
        });
        return { kind: 'stale' as const, target };
      }
      if (!pubkey) {
        logger.info('effects.recipientPubkey.empty', {
          targetLength: target.length,
        });
        return { kind: 'empty' as const, target };
      }
      logger.info('effects.recipientPubkey.resolved', {
        targetLength: target.length,
        pubkeyLength: pubkey.length,
      });
      return { kind: 'resolved' as const, target, pubkey };
    },
    (cause): RecipientPubkeyEffectError => {
      logger.warn('effects.recipientPubkey.threw', {
        targetLength: target.length,
        error: errField(cause),
      });
      return {
        kind: 'failed',
        target,
        cause,
      };
    },
  )().orElse((failure) => {
    if (isStale('resolveRecipientPubkey.catch')) {
      logger.info('effects.recipientPubkey.stale', {
        op: 'resolveRecipientPubkey.catch',
        targetLength: target.length,
      });
      return okAsync({ kind: 'stale' as const, target });
    }
    logger.warn('effects.recipientPubkey.failed', {
      targetLength: target.length,
      error: errField(failure.cause),
    });
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
  logger.info('effects.recipientProfile.start', {
    pubkeyLength: pubkey.length,
  });

  return ResultAsync.fromThrowable(
    async () => {
      const profile = await operation(pubkey);
      if (isStale('resolveRecipientProfile')) {
        logger.info('effects.recipientProfile.stale', {
          op: 'resolveRecipientProfile',
          pubkeyLength: pubkey.length,
        });
        return { kind: 'stale' as const, pubkey };
      }
      if (!profile) {
        logger.info('effects.recipientProfile.empty', {
          pubkeyLength: pubkey.length,
        });
        return { kind: 'empty' as const, pubkey };
      }
      logger.info('effects.recipientProfile.resolved', {
        pubkeyLength: pubkey.length,
        hasDisplayName: profile.displayName.length > 0,
        hasAvatarUrl: !!profile.avatarUrl,
        hasNip05: !!profile.nip05,
      });
      return { kind: 'resolved' as const, pubkey, profile };
    },
    (cause): RecipientProfileEffectError => {
      logger.warn('effects.recipientProfile.threw', {
        pubkeyLength: pubkey.length,
        error: errField(cause),
      });
      return {
        kind: 'failed',
        pubkey,
        cause,
      };
    },
  )().orElse((failure) => {
    if (isStale('resolveRecipientProfile.catch')) {
      logger.info('effects.recipientProfile.stale', {
        op: 'resolveRecipientProfile.catch',
        pubkeyLength: pubkey.length,
      });
      return okAsync({ kind: 'stale' as const, pubkey });
    }
    logger.warn('effects.recipientProfile.failed', {
      pubkeyLength: pubkey.length,
      error: errField(failure.cause),
    });
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

  logger.info('effects.confirmSend.start', {
    ...mintUrlFields(data.mintUrl),
    amount: data.amount,
    unit: context.unit,
    p2pkLocked,
    appOffline,
    forceLocalSend,
    hasExactLocalProofs,
    shouldCreateLocalTokenFirst,
    proofCount: proofAmounts.length,
    hasOfflineSend: !!operations.executeOfflineSend,
    hasMemo: !!data.memo,
    context: summarizeContext(context),
  });

  // Locked + offline fails fast: there is no offline shape of a locked send,
  // so don't even attempt the operation or any fallback routing.
  if (p2pkLocked && appOffline) {
    logger.warn('effects.confirmSend.blocked', {
      reason: 'p2pk_locked_offline',
      ...mintUrlFields(data.mintUrl),
      amount: data.amount,
      proofCount: proofAmounts.length,
    });
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
    return executeSendOperation(
      operations.executeOfflineSend,
      data,
      undefined,
      'localFirst',
    )
      .andThen((result) => {
        if (isStale('executeOfflineSend.localFirst')) {
          logger.info('effects.confirmSend.stale', {
            op: 'executeOfflineSend.localFirst',
            path: 'localFirst',
          });
          return okAsync({ kind: 'stale' } as const);
        }

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
    logger.info('effects.confirmSend.forcedLocal', {
      ...mintUrlFields(data.mintUrl),
      amount: data.amount,
      appOffline,
      contextOffline: context.offline === true,
      localProofSend: context.localProofSend === true,
    });
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
    'online',
  )
    .andThen((result) => {
      if (isStale('executeSend')) {
        logger.info('effects.confirmSend.stale', {
          op: 'executeSend',
          path: 'online',
        });
        return okAsync({ kind: 'stale' } as const);
      }

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
