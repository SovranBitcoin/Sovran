/**
 * An AI payment is two wallet movements that mean one thing.
 *
 * `@routstr/sdk` spends and banks through the Coco wallet adapter, and its
 * `WalletAdapter` seam has nowhere to thread a caller's context through — so
 * the context is ambient, opened around the request and again around the
 * finalize. These are the properties that makes that safe to rely on:
 *
 *  1. Both legs carry the SAME `groupId` and the message they bought, so a
 *     cost in history can be traced back to the answer it paid for — the
 *     relationship a zap has to its post.
 *  2. The two legs carry DIFFERENT roles, so a grouped row can tell what went
 *     out from what came back.
 *  3. Outside a scope nothing is written. A wallet send that has nothing to do
 *     with AI must not inherit the last chat's label.
 */

const annotations: Record<string, unknown> = {};

jest.mock('@/shared/stores/profile/transactionAnnotationStore', () => ({
  setTransactionAnnotation: (key: string, patch: unknown) => {
    annotations[key] = patch;
  },
}));

jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { apiLog: noop, aiLog: noop, storeLog: noop, log: noop, applyFileLogging: jest.fn() };
});

jest.mock('@cashu/cashu-ts', () => ({
  getEncodedToken: () => 'cashuB-minted',
  getTokenMetadata: () => ({ amount: { toNumber: () => 4 } }),
}));

jest.mock('@/shared/stores/profile/mintStore', () => ({
  useMintStore: { getState: () => ({ selectedMint: 'https://mint.example' }) },
}));

jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    peekInstance: () => ({
      ops: {
        send: {
          prepare: async () => ({}),
          execute: async () => ({ operation: { id: 'op-send' }, token: {} }),
        },
        receive: {
          prepare: async () => ({}),
          execute: async () => ({ id: 'op-receive' }),
        },
      },
    }),
  },
}));

import { cocoWalletAdapter } from '@/shared/lib/routstr/sdk/walletAdapter';
import { withPaymentScope } from '@/shared/lib/routstr/sdk/paymentScope';

const context = {
  groupId: 'flow-1',
  sessionId: 'session-1',
  messageId: 'message-1',
  model: 'claude-haiku-4.5',
};

describe('AI payment annotation', () => {
  beforeEach(() => {
    for (const key of Object.keys(annotations)) delete annotations[key];
  });

  it('ties both legs to the message they bought', async () => {
    await withPaymentScope(context, () =>
      cocoWalletAdapter.sendToken('https://mint.example', 10)
    );
    // The change comes back later, in its own scope — that is the shape of a
    // streamed response, where the money returns only once the stream ends.
    await withPaymentScope(context, () => cocoWalletAdapter.receiveToken('cashuB-change'));

    expect(annotations['op:op-send']).toMatchObject({
      ai: {
        groupId: 'flow-1',
        role: 'payment',
        sessionId: 'session-1',
        messageId: 'message-1',
        model: 'claude-haiku-4.5',
      },
    });
    expect(annotations['op:op-receive']).toMatchObject({
      ai: { groupId: 'flow-1', role: 'change', messageId: 'message-1' },
    });
  });

  it('leaves an unrelated wallet movement unlabelled', async () => {
    await cocoWalletAdapter.sendToken('https://mint.example', 10);
    expect(annotations['op:op-send']).toBeUndefined();
  });
});
