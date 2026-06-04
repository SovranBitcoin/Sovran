import { describe, expect, it, vi } from 'vitest';

import {
  runConfirmMeltEffect,
  runConfirmPaymentRequestEffect,
  runConfirmSendEffect,
  runMintListEnrichmentEffect,
  runMintReviewInfoEffect,
  runMintQuoteEffect,
  runNfcWriteBackEffect,
  runRecipientProfileEffect,
  runRecipientPubkeyEffect,
  runTrustMintEffect,
} from '../../src/machine/effects';
import type { StepDataMap } from '../../src/machine/types';

const mintQuoteData: StepDataMap['createMintQuote'] = {
  mintUrl: 'https://mint.example',
  amount: 123,
  unit: 'sat',
};

const confirmSendData: StepDataMap['confirmSend'] = {
  mintUrl: 'https://mint.example',
  amount: 100,
};

const confirmMeltData: StepDataMap['navigateToMeltPreview'] = {
  mintUrl: 'https://mint.example',
  meltTarget: 'lnurl1target',
  amount: 250,
  unit: 'sat',
};

const confirmPaymentRequestData: StepDataMap['navigateToPaymentRequest'] = {
  mintUrl: 'https://mint.example',
  paymentRequest: 'creq1request',
  amount: 250,
  unit: 'sat',
};

const reviewMintData: StepDataMap['reviewMint'] = {
  mintUrl: 'https://mint.example',
  token: 'cashu-token',
};

const openMintData: StepDataMap['openMint'] = {
  url: 'https://mint.example',
};

const selectMintData: StepDataMap['selectMint'] = {
  candidates: [{ mintUrl: 'https://mint.example', balance: 100 }],
  unit: 'sat',
};

const mintReviewInfo = {
  mintUrl: 'https://mint.example',
  displayName: 'Example Mint',
  balance: 0,
  unit: 'sat',
  isPreferred: false,
  isTrusted: false,
};

const recipientProfile = {
  displayName: 'Alice',
  avatarUrl: 'https://example.com/alice.png',
  nip05: 'alice@example.com',
};

const sendContext = {
  unit: 'sat',
  rawInput: 'cashu:input',
  source: 'qr' as const,
};

function sendHistoryEntry(id: string): string {
  return JSON.stringify({ id, type: 'send' });
}

function meltHistoryEntry(id: string): string {
  return JSON.stringify({ id, type: 'melt', state: 'PAID' });
}

function paymentRequestHistoryEntry(id: string): string {
  return JSON.stringify({ id, type: 'send', state: 'pending' });
}

function mintFetchError(): Error {
  const error = new Error('Mint unreachable');
  error.name = 'MintFetchError';
  return error;
}

describe('runMintQuoteEffect', () => {
  it('creates a mint quote result and transaction-created notification', async () => {
    const executeMintQuote = vi.fn(async () => ({
      historyEntry: JSON.stringify({ id: 'mint-entry-1', type: 'mint' }),
    }));

    const result = await runMintQuoteEffect({
      data: mintQuoteData,
      operations: { executeMintQuote },
      context: { unit: 'sat', rawInput: 'cashu:input', source: 'qr' },
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executeMintQuote).toHaveBeenCalledWith(
      'https://mint.example',
      123,
      'sat',
      undefined,
    );
    expect(result.value).toMatchObject({
      kind: 'completed',
      step: 'mintQuoteCreated',
      data: {
        historyEntry: expect.any(String),
        unit: 'sat',
      },
      notifications: [
        {
          type: 'onTransactionCreated',
          data: {
            transactionId: 'mint-entry-1',
            type: 'mint',
            mintUrl: 'https://mint.example',
            amount: 123,
            unit: 'sat',
            rawInput: 'cashu:input',
            source: 'qr',
          },
        },
      ],
    });
  });

  it('returns a stale result when the operation resolves after reset', async () => {
    const result = await runMintQuoteEffect({
      data: mintQuoteData,
      operations: {
        executeMintQuote: async () => ({
          historyEntry: JSON.stringify({ id: 'late-mint-entry', type: 'mint' }),
        }),
      },
      context: { unit: 'sat' },
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: (op) => op === 'executeMintQuote',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });

  it('does not call executeMintQuote when offline', async () => {
    const executeMintQuote = vi.fn(async () => ({
      historyEntry: JSON.stringify({ id: 'mint-entry-1', type: 'mint' }),
    }));

    const result = await runMintQuoteEffect({
      data: mintQuoteData,
      operations: { executeMintQuote },
      context: { unit: 'sat' },
      getOffline: () => true,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    expect(executeMintQuote).not.toHaveBeenCalled();
    if (result.isOk()) return;
    expect(result.error.data).toMatchObject({
      code: 'MINT_QUOTE_FAILED',
      data: { mintUnreachable: true },
    });
  });
});

describe('recipient identity effects', () => {
  it('resolves a lightning-address target to a recipient pubkey', async () => {
    const resolveRecipientPubkey = vi.fn(async () => 'a'.repeat(64));

    const result = await runRecipientPubkeyEffect({
      target: 'alice@example.com',
      operation: resolveRecipientPubkey,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(resolveRecipientPubkey).toHaveBeenCalledWith('alice@example.com');
    expect(result.value).toEqual({
      kind: 'resolved',
      target: 'alice@example.com',
      pubkey: 'a'.repeat(64),
    });
  });

  it('returns empty when recipient pubkey resolution has no identity', async () => {
    const result = await runRecipientPubkeyEffect({
      target: 'cashu-token',
      operation: async () => null,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({
      kind: 'empty',
      target: 'cashu-token',
    });
  });

  it('resolves a recipient profile from a pubkey', async () => {
    const pubkey = 'a'.repeat(64);
    const resolveRecipientProfile = vi.fn(async () => recipientProfile);

    const result = await runRecipientProfileEffect({
      pubkey,
      operation: resolveRecipientProfile,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(resolveRecipientProfile).toHaveBeenCalledWith(pubkey);
    expect(result.value).toEqual({
      kind: 'resolved',
      pubkey,
      profile: recipientProfile,
    });
  });

  it('preserves thrown recipient lookup failures as typed errors', async () => {
    const failure = new Error('NIP-05 failed');
    const result = await runRecipientPubkeyEffect({
      target: 'alice@example.com',
      operation: async () => {
        throw failure;
      },
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toEqual({
      kind: 'failed',
      target: 'alice@example.com',
      cause: failure,
    });
  });

  it('returns stale recipient profile results after a reset', async () => {
    const pubkey = 'a'.repeat(64);

    const result = await runRecipientProfileEffect({
      pubkey,
      operation: async () => recipientProfile,
      isStale: (op) => op === 'resolveRecipientProfile',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale', pubkey });
  });
});

describe('runMintReviewInfoEffect', () => {
  it('loads mint info for reviewMint step data', async () => {
    const buildMintReviewInfo = vi.fn(async () => mintReviewInfo);

    const result = await runMintReviewInfoEffect({
      step: 'reviewMint',
      data: reviewMintData,
      operation: buildMintReviewInfo,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(buildMintReviewInfo).toHaveBeenCalledWith('https://mint.example');
    expect(result.value).toEqual({
      kind: 'completed',
      step: 'reviewMint',
      data: {
        ...reviewMintData,
        mintInfo: mintReviewInfo,
      },
    });
  });

  it('loads mint info for openMint step data', async () => {
    const buildMintReviewInfo = vi.fn(async () => mintReviewInfo);

    const result = await runMintReviewInfoEffect({
      step: 'openMint',
      data: openMintData,
      operation: buildMintReviewInfo,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(buildMintReviewInfo).toHaveBeenCalledWith('https://mint.example');
    expect(result.value).toEqual({
      kind: 'completed',
      step: 'openMint',
      data: {
        ...openMintData,
        mintInfo: mintReviewInfo,
      },
    });
  });

  it('maps mint info failures to UNSUPPORTED_INPUT', async () => {
    const result = await runMintReviewInfoEffect({
      step: 'reviewMint',
      data: reviewMintData,
      operation: async () => {
        throw new Error('Info unavailable');
      },
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.data).toMatchObject({
      code: 'UNSUPPORTED_INPUT',
      message: 'Info unavailable',
    });
  });

  it('returns stale when mint info resolves after reset', async () => {
    const result = await runMintReviewInfoEffect({
      step: 'reviewMint',
      data: reviewMintData,
      operation: async () => mintReviewInfo,
      getLocale: () => 'en',
      isStale: (op) => op === 'buildMintReviewInfo',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });
});

describe('runTrustMintEffect', () => {
  it('trusts the reviewed mint', async () => {
    const trustMint = vi.fn(async () => {});

    const result = await runTrustMintEffect({
      data: reviewMintData,
      operation: trustMint,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    expect(trustMint).toHaveBeenCalledWith('https://mint.example');
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'completed' });
  });

  it('maps trust failures to UNSUPPORTED_INPUT', async () => {
    const result = await runTrustMintEffect({
      data: reviewMintData,
      operation: async () => {
        throw new Error('Trust failed');
      },
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.data).toMatchObject({
      code: 'UNSUPPORTED_INPUT',
      message: 'Trust failed',
    });
  });

  it('returns stale when trust resolves after reset', async () => {
    const result = await runTrustMintEffect({
      data: reviewMintData,
      operation: async () => {},
      getLocale: () => 'en',
      isStale: (op) => op === 'trustMint',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });
});

describe('runMintListEnrichmentEffect', () => {
  it('returns enriched mint list items', async () => {
    const buildMintListItems = vi.fn(async () => [
      {
        mintUrl: 'https://mint.example',
        displayName: 'Example Mint',
        balance: 100,
        unit: 'sat',
        status: 'available' as const,
        reason: null,
        isPreferred: true,
      },
    ]);

    const result = await runMintListEnrichmentEffect({
      data: selectMintData,
      operation: buildMintListItems,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(buildMintListItems).toHaveBeenCalledWith(selectMintData);
    expect(result.value).toMatchObject({
      kind: 'completed',
      items: [
        {
          mintUrl: 'https://mint.example',
          displayName: 'Example Mint',
        },
      ],
    });
  });

  it('returns failure when mint list enrichment rejects', async () => {
    const result = await runMintListEnrichmentEffect({
      data: selectMintData,
      operation: async () => {
        throw new Error('Network error');
      },
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toMatchObject({
      kind: 'failed',
      cause: expect.any(Error),
    });
  });

  it('returns stale when mint list enrichment resolves after reset', async () => {
    const result = await runMintListEnrichmentEffect({
      data: selectMintData,
      operation: async () => [],
      isStale: (op) => op === 'buildMintListItems',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });
});

describe('runConfirmMeltEffect', () => {
  it('creates a melt result with link and notification payloads', async () => {
    const executeMelt = vi.fn(async () => ({
      historyEntry: meltHistoryEntry('melt-entry-1'),
    }));

    const result = await runConfirmMeltEffect({
      data: confirmMeltData,
      operation: executeMelt,
      context: sendContext,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executeMelt).toHaveBeenCalledWith(
      'https://mint.example',
      'lnurl1target',
      250,
      'sat',
    );
    expect(result.value).toMatchObject({
      kind: 'completed',
      step: 'navigateToMeltPreview',
      data: {
        historyEntry: expect.any(String),
      },
      links: [
        {
          type: 'linkTransaction',
          input: 'lnurl1target',
          transactionId: 'melt-entry-1',
        },
      ],
      notifications: [
        {
          type: 'onPaymentConfirmed',
          data: {
            variant: 'melt',
            mintUrl: 'https://mint.example',
            amount: 250,
            unit: 'sat',
            historyEntry: expect.any(String),
          },
        },
        {
          type: 'onTransactionCreated',
          data: {
            transactionId: 'melt-entry-1',
            type: 'melt',
            mintUrl: 'https://mint.example',
            amount: 250,
            unit: 'sat',
            rawInput: 'cashu:input',
            source: 'qr',
          },
        },
        {
          type: 'onMeltQuoteCreated',
          data: {
            mintUrl: 'https://mint.example',
            operationId: 'melt-entry-1',
            amount: 250,
            unit: 'sat',
            meltTarget: 'lnurl1target',
          },
        },
      ],
    });
  });

  it('returns failure when executeMelt rejects', async () => {
    const result = await runConfirmMeltEffect({
      data: confirmMeltData,
      operation: async () => {
        throw new Error('Route not found');
      },
      context: sendContext,
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toMatchObject({
      kind: 'failed',
      cause: expect.any(Error),
    });
  });

  it('returns a stale result when executeMelt resolves after reset', async () => {
    const result = await runConfirmMeltEffect({
      data: confirmMeltData,
      operation: async () => ({
        historyEntry: meltHistoryEntry('late-melt-entry'),
      }),
      context: sendContext,
      isStale: (op) => op === 'executeMelt',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });
});

describe('runConfirmPaymentRequestEffect', () => {
  it('creates a payment request result with link and notification payloads', async () => {
    const executePaymentRequest = vi.fn(async () => ({
      historyEntry: paymentRequestHistoryEntry('payment-request-entry-1'),
    }));

    const result = await runConfirmPaymentRequestEffect({
      data: confirmPaymentRequestData,
      operation: executePaymentRequest,
      context: sendContext,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executePaymentRequest).toHaveBeenCalledWith(
      'https://mint.example',
      'creq1request',
      250,
      'sat',
    );
    expect(result.value).toMatchObject({
      kind: 'completed',
      step: 'navigateToPaymentRequest',
      data: {
        historyEntry: expect.any(String),
      },
      links: [
        {
          type: 'linkTransaction',
          input: 'creq1request',
          transactionId: 'payment-request-entry-1',
        },
      ],
      notifications: [
        {
          type: 'onPaymentConfirmed',
          data: {
            variant: 'paymentRequest',
            mintUrl: 'https://mint.example',
            amount: 250,
            unit: 'sat',
            historyEntry: expect.any(String),
          },
        },
        {
          type: 'onTransactionCreated',
          data: {
            transactionId: 'payment-request-entry-1',
            type: 'send',
            mintUrl: 'https://mint.example',
            amount: 250,
            unit: 'sat',
            rawInput: 'cashu:input',
            source: 'qr',
          },
        },
      ],
    });
  });

  it('returns a rolledBack result without treating rollback as a thrown failure', async () => {
    const result = await runConfirmPaymentRequestEffect({
      data: confirmPaymentRequestData,
      operation: async () => ({
        historyEntry: paymentRequestHistoryEntry('payment-request-entry-1'),
        rolledBack: true,
        errorMessage: 'Delivery failed',
      }),
      context: sendContext,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toMatchObject({
      kind: 'rolledBack',
      errorMessage: 'Delivery failed',
      cause: expect.any(Error),
    });
  });

  it('returns failure when executePaymentRequest rejects', async () => {
    const result = await runConfirmPaymentRequestEffect({
      data: confirmPaymentRequestData,
      operation: async () => {
        throw new Error('Transport down');
      },
      context: sendContext,
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error).toMatchObject({
      kind: 'failed',
      cause: expect.any(Error),
    });
  });

  it('returns a stale result when executePaymentRequest resolves after reset', async () => {
    const result = await runConfirmPaymentRequestEffect({
      data: confirmPaymentRequestData,
      operation: async () => ({
        historyEntry: paymentRequestHistoryEntry('late-payment-request-entry'),
      }),
      context: sendContext,
      isStale: (op) => op === 'executePaymentRequest',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });
});

describe('runNfcWriteBackEffect', () => {
  it('creates an NFC token, writes it back, and returns success intents', async () => {
    const executeNfcSend = vi.fn(async () => ({
      token: 'cashuBnfc-token',
      historyEntry: sendHistoryEntry('nfc-send-entry-1'),
      operationId: 'operation-1',
    }));
    const writeToken = vi.fn(async () => {});
    const releaseSession = vi.fn(async () => {});
    const onProgress = vi.fn();

    const result = await runNfcWriteBackEffect({
      data: confirmPaymentRequestData,
      executeNfcSend,
      nfcAdapter: { writeToken, releaseSession },
      context: {
        ...sendContext,
        source: 'nfc',
        recipientPubkey: 'a'.repeat(64),
        recipientProfile,
      },
      onProgress,
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executeNfcSend).toHaveBeenCalledWith('https://mint.example', 250);
    expect(writeToken).toHaveBeenCalledWith('cashuBnfc-token');
    expect(releaseSession).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: 'creating' });
    expect(onProgress).toHaveBeenNthCalledWith(2, { phase: 'writing' });
    expect(result.value).toMatchObject({
      kind: 'completed',
      step: 'sendComplete',
      data: {
        historyEntry: expect.any(String),
        recipientPubkey: 'a'.repeat(64),
        recipientProfile,
      },
      links: [
        {
          type: 'linkTransaction',
          input: 'cashu:input',
          transactionId: 'nfc-send-entry-1',
        },
      ],
      notifications: [
        {
          type: 'onPaymentConfirmed',
          data: {
            variant: 'send',
            mintUrl: 'https://mint.example',
            amount: 250,
            unit: 'sat',
            historyEntry: expect.any(String),
          },
        },
        {
          type: 'onTransactionCreated',
          data: {
            transactionId: 'nfc-send-entry-1',
            type: 'send',
            mintUrl: 'https://mint.example',
            amount: 250,
            unit: 'sat',
            rawInput: 'cashu:input',
            source: 'nfc',
          },
        },
      ],
    });
  });

  it('rolls back and releases the NFC session when write-back fails', async () => {
    const writeFailure = new Error('Tag removed');
    const rollbackSend = vi.fn(async () => {});
    const releaseSession = vi.fn(async () => {});

    const result = await runNfcWriteBackEffect({
      data: confirmPaymentRequestData,
      executeNfcSend: async () => ({
        token: 'cashuBnfc-token',
        historyEntry: sendHistoryEntry('nfc-send-entry-1'),
        operationId: 'operation-1',
      }),
      rollbackSend,
      nfcAdapter: {
        writeToken: async () => {
          throw writeFailure;
        },
        releaseSession,
      },
      context: sendContext,
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    expect(rollbackSend).toHaveBeenCalledWith('operation-1');
    expect(releaseSession).toHaveBeenCalledTimes(1);
    if (result.isOk()) return;
    expect(result.error).toMatchObject({
      kind: 'failed',
      cause: writeFailure,
      rolledBack: true,
      data: {
        code: 'NFC_WRITE_FAILED',
        message: 'Tag removed',
      },
      notifications: [
        {
          type: 'onNfcWriteFailed',
          data: { message: 'Tag removed', rolledBack: true },
        },
      ],
    });
  });

  it('returns stale before writing when NFC send resolves after reset', async () => {
    const writeToken = vi.fn(async () => {});

    const result = await runNfcWriteBackEffect({
      data: confirmPaymentRequestData,
      executeNfcSend: async () => ({
        token: 'cashuBnfc-token',
        historyEntry: sendHistoryEntry('nfc-send-entry-1'),
        operationId: 'operation-1',
      }),
      nfcAdapter: {
        writeToken,
        releaseSession: async () => {},
      },
      context: sendContext,
      isStale: (op) => op === 'executeNfcSend',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
    expect(writeToken).not.toHaveBeenCalled();
  });
});

describe('runConfirmSendEffect', () => {
  it('creates an online send result and transaction-created notification', async () => {
    const executeSend = vi.fn(async () => ({
      historyEntry: sendHistoryEntry('send-entry-1'),
    }));
    const executeOfflineSend = vi.fn(async () => ({
      historyEntry: sendHistoryEntry('offline-entry-1'),
    }));

    const result = await runConfirmSendEffect({
      data: confirmSendData,
      operations: { executeSend, executeOfflineSend },
      context: sendContext,
      proofAmounts: [64, 32, 8],
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executeSend).toHaveBeenCalledWith('https://mint.example', 100);
    expect(executeOfflineSend).not.toHaveBeenCalled();
    expect(result.value).toMatchObject({
      kind: 'completed',
      path: 'online',
      step: 'sendComplete',
      data: {
        historyEntry: expect.any(String),
      },
      notifications: [
        {
          type: 'onTransactionCreated',
          data: {
            transactionId: 'send-entry-1',
            type: 'send',
            mintUrl: 'https://mint.example',
            amount: 100,
            unit: 'sat',
            rawInput: 'cashu:input',
            source: 'qr',
          },
        },
      ],
    });
  });

  it('uses exact local proofs first when offline send is available', async () => {
    const executeSend = vi.fn(async () => ({
      historyEntry: sendHistoryEntry('send-entry-1'),
    }));
    const executeOfflineSend = vi.fn(async () => ({
      historyEntry: sendHistoryEntry('offline-entry-1'),
    }));

    const result = await runConfirmSendEffect({
      data: confirmSendData,
      operations: { executeSend, executeOfflineSend },
      context: sendContext,
      proofAmounts: [64, 32, 4],
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executeOfflineSend).toHaveBeenCalledWith(
      'https://mint.example',
      100,
    );
    expect(executeSend).not.toHaveBeenCalled();
    expect(result.value).toMatchObject({
      kind: 'completed',
      path: 'localFirst',
      data: {
        createdOffline: true,
      },
    });
    expect(result.value).not.toMatchObject({
      data: { mintWasOffline: true },
    });
  });

  it('returns chooseProofs with mint-unreachable context after online failure', async () => {
    const result = await runConfirmSendEffect({
      data: confirmSendData,
      operations: {
        executeSend: async () => {
          throw mintFetchError();
        },
      },
      context: sendContext,
      proofAmounts: [64, 32, 8],
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value).toMatchObject({
      kind: 'chooseProofs',
      step: 'chooseProofs',
      context: { mintUnreachableConfirmed: true },
      data: {
        mintUrl: 'https://mint.example',
        amount: 100,
        suggestions: {
          roundDown: { amount: 96 },
          roundUp: { amount: 104 },
        },
      },
    });
  });

  it('marks a local proof send as mintWasOffline after a mint failure', async () => {
    const executeOfflineSend = vi.fn(async () => ({
      historyEntry: sendHistoryEntry('offline-entry-1'),
    }));

    const result = await runConfirmSendEffect({
      data: { ...confirmSendData, amount: 96 },
      operations: {
        executeSend: async () => ({
          historyEntry: sendHistoryEntry('send-entry-1'),
        }),
        executeOfflineSend,
      },
      context: { ...sendContext, mintUnreachableConfirmed: true },
      proofAmounts: [64, 32, 8],
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(executeOfflineSend).toHaveBeenCalledWith('https://mint.example', 96);
    expect(result.value).toMatchObject({
      kind: 'completed',
      path: 'localFirst',
      data: {
        createdOffline: true,
        mintWasOffline: true,
      },
    });
  });

  it('routes send failures with no fallback proofs to SEND_FAILED', async () => {
    const result = await runConfirmSendEffect({
      data: confirmSendData,
      operations: {
        executeSend: async () => {
          throw new Error('No proofs');
        },
      },
      context: sendContext,
      proofAmounts: [],
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: () => false,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) return;
    expect(result.error.data).toMatchObject({
      code: 'SEND_FAILED',
      message: 'No proofs',
    });
  });

  it('returns a stale result when the operation resolves after reset', async () => {
    const result = await runConfirmSendEffect({
      data: confirmSendData,
      operations: {
        executeSend: async () => ({
          historyEntry: sendHistoryEntry('late-send-entry'),
        }),
      },
      context: sendContext,
      proofAmounts: [64, 32, 8],
      getOffline: () => false,
      getLocale: () => 'en',
      isStale: (op) => op === 'executeSend',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;
    expect(result.value).toEqual({ kind: 'stale' });
  });
});
