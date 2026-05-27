/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * defaultHandlers.test.ts — Default Screen Action Handlers
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests for createDefaultScreenActionHandlers — the batteries-included
 * default handlers for all screen types. These handlers use:
 *   - operations: async work (checkSendStatus, executeReceive, etc.)
 *   - notifications: fire-and-forget UI feedback (onSendCancelled, etc.)
 *   - navigation: routing callbacks (scanQr, mintInfo, addMint, goBack)
 *   - machine: PaymentMachine instance for delegated actions
 *
 * Each test creates a standalone handler config (no React, no provider)
 * and exercises the handler through the ScreenActionManager's execute().
 */

import { describe, it, expect, vi } from 'vitest';

import { createDefaultScreenActionHandlers } from '../../src/screen-actions/defaultHandlers';
import { createScreenActionManager } from '../../src/screen-actions/createManager';
import { deriveMintMethodCapabilityMapFromTrustedMints } from '../../src/mint-capabilities';
import type { MachineOperations, PaymentMachine, ProcessResult } from '../../src/machine/types';
import type {
  ScreenActionContext,
  ScreenActionHandlerMap,
  ScreenActionManager,
  ScreenType,
} from '../../src/screen-actions/types';
import type {
  DefaultScreenActionHandlersConfig,
  NavigationCallbacks,
} from '../../src/screen-actions/defaultHandlers';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const MINT1 = 'https://mint1.example.com';
const MINT2 = 'https://mint2.example.com';
type MockFn = ReturnType<typeof vi.fn>;

function createMockConfig(overrides?: {
  operations?: Partial<MachineOperations>;
  machine?: Partial<PaymentMachine>;
  navigation?: Partial<NavigationCallbacks>;
  getOffline?: () => boolean;
}) {
  const notifications: { event: string; args: unknown[] }[] = [];
  const ops: Partial<MachineOperations> = {
    checkSendStatus: vi.fn(async () => ({ state: 'pending' })),
    rollbackSend: vi.fn(async () => {}),
    executeReceive: vi.fn(async () => ({
      historyEntry: JSON.stringify({ id: 'rx-1', type: 'receive', mintUrl: MINT1, amount: 100 }),
    })),
    isMintTrusted: vi.fn(async () => true),
    trustMint: vi.fn(async () => {}),
    rollbackMelt: vi.fn(async () => {}),
    buildMintReviewInfo: vi.fn(async (mintUrl: string) => ({
      mintUrl,
      displayName: mintUrl,
      balance: 0,
      unit: 'sat',
      isPreferred: false,
      isTrusted: true,
    })) as MachineOperations['buildMintReviewInfo'],
    linkTransaction: vi.fn(() => {}),
    ...overrides?.operations,
  };

  const machine: Partial<PaymentMachine> = {
    confirmMelt: vi.fn(async () => {}),
    confirmPaymentRequest: vi.fn(async () => ({ rolledBack: false })),
    scan: vi.fn(async (): Promise<ProcessResult> => ({ urInProgress: false })),
    startReceiveLightning: vi.fn(async () => {}),
    requestMintSelector: vi.fn(async () => {}),
    changeMint: vi.fn(async () => {}),
    enterAmount: vi.fn(async () => {}),
    reviewMint: vi.fn(async () => {}),
    getContext: vi.fn(() => ({ unit: 'sat' })),
    ...overrides?.machine,
  };

  const navigation: NavigationCallbacks = {
    scanQr: vi.fn(),
    mintInfo: vi.fn(),
    addMint: vi.fn(),
    goBack: vi.fn(),
    ...overrides?.navigation,
  };

  const config: DefaultScreenActionHandlersConfig = {
    getMachine: () => machine as PaymentMachine,
    getOperations: () => ops,
    getOffline: overrides?.getOffline,
    notify: (event: string, ...args: unknown[]) => {
      notifications.push({ event, args });
    },
    navigation,
  };

  const handlers = createDefaultScreenActionHandlers(config);

  return { handlers, ops, machine, navigation, notifications };
}

function createManager(
  screenType: ScreenType,
  handlers: ScreenActionHandlerMap,
  entry: Record<string, unknown>,
  extraContext?: Record<string, unknown>
) {
  const setEntry = vi.fn();
  let mgrRef: ScreenActionManager<ScreenType> | null = null;
  const mgr: ScreenActionManager<ScreenType> = createScreenActionManager({
    screenType,
    handlers: {},
    defaultHandlers: handlers[screenType],
    getContext: (): ScreenActionContext => ({
      entry: mgrRef?.getEntry() ?? {},
      manager: null,
      setEntry: (e: Record<string, unknown>) => {
        setEntry(e);
        mgrRef?.setEntry(e);
      },
      ...extraContext,
    }),
  });
  mgrRef = mgr;
  mgr.setEntry(entry);
  return { mgr, setEntry };
}

// ---------------------------------------------------------------------------
// built-in copy/share targets
// ---------------------------------------------------------------------------

describe('back default handlers', () => {
  const screens: ScreenType[] = [
    'sendToken',
    'receiveToken',
    'mintQuote',
    'meltQuote',
    'paymentRequest',
    'receive',
    'mintInfo',
    'amountEntry',
    'mintSelector',
  ];

  it.each(screens)('%s delegates to navigation.goBack', async (screenType) => {
    const { handlers, navigation } = createMockConfig();
    const { mgr } = createManager(screenType, handlers, {});

    await mgr.execute('back');

    expect(navigation.goBack).toHaveBeenCalled();
  });
});

describe('built-in copy/share targets', () => {
  it('labels mint quote clipboard copies as Lightning invoices', async () => {
    const writeClipboard = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: 'mintQuote',
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          writeClipboard,
          notify,
        };
        return context;
      },
    });

    mgr.setEntry({ paymentRequest: 'lnbc1invoice' });

    await mgr.execute('copy');

    expect(writeClipboard).toHaveBeenCalledWith('lnbc1invoice');
    expect(notify).toHaveBeenCalledWith('onCopied', 'lightningInvoice', 'lnbc1invoice');
  });

  it('copies operation-backed onchain mint quotes as exact-amount BIP321 URIs', async () => {
    const writeClipboard = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: 'mintQuote',
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          writeClipboard,
          notify,
        };
        return context;
      },
    });
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
    const bip321 = `bitcoin:${address}?amount=0.00001234&message=For%20coffee`;

    mgr.setEntry({
      paymentRequest: address,
      amount: 0,
      unit: 'sat',
      metadata: {
        method: 'onchain',
        onchainAddress: address,
        requestedAmount: '1234',
        memo: 'For coffee',
      },
    });

    await mgr.execute('copy');

    expect(writeClipboard).toHaveBeenCalledWith(bip321);
    expect(notify).toHaveBeenCalledWith('onCopied', 'address', bip321);
  });

  it('labels mint quote shares as Lightning invoices', async () => {
    const shareContent = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: 'mintQuote',
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          shareContent,
          notify,
        };
        return context;
      },
    });

    mgr.setEntry({ paymentRequest: 'lnbc1invoice' });

    await mgr.execute('share');

    expect(shareContent).toHaveBeenCalledWith({ message: 'lnbc1invoice', url: undefined });
    expect(notify).toHaveBeenCalledWith('onShared', 'lightningInvoice', 'lnbc1invoice');
  });

  it('shares operation-backed onchain mint quotes as exact-amount BIP321 URIs', async () => {
    const shareContent = vi.fn(async () => {});
    const notify = vi.fn();
    const mgr = createScreenActionManager({
      screenType: 'mintQuote',
      handlers: {},
      getContext: () => {
        const context: ScreenActionContext = {
          entry: {},
          manager: null,
          setEntry: () => {},
          shareContent,
          notify,
        };
        return context;
      },
    });
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
    const bip321 = `bitcoin:${address}?amount=0.00001234`;

    mgr.setEntry({
      paymentRequest: address,
      amount: 0,
      unit: 'sat',
      metadata: { method: 'onchain', onchainAddress: address, requestedAmount: '1234' },
    });

    await mgr.execute('share');

    expect(shareContent).toHaveBeenCalledWith({ message: bip321, url: undefined });
    expect(notify).toHaveBeenCalledWith('onShared', 'address', bip321);
  });
});

// ---------------------------------------------------------------------------
// sendToken
// ---------------------------------------------------------------------------

describe('sendToken default handlers', () => {
  describe('checkStatus', () => {
    it('calls checkSendStatus and notifies with result', async () => {
      const { handlers, ops, notifications } = createMockConfig({
        operations: {
          checkSendStatus: vi.fn(async () => ({ state: 'finalized' })),
        },
      });

      const { mgr } = createManager('sendToken', handlers, {
        type: 'send',
        operationId: 'op-123',
        token: null,
      });

      await mgr.execute('checkStatus');

      expect(ops.checkSendStatus).toHaveBeenCalledWith('op-123');
      expect(notifications).toContainEqual({
        event: 'onSendStatusChecked',
        args: [{ operationId: 'op-123', state: 'finalized', redeemed: true }],
      });
    });

    it('reports non-finalized as not redeemed', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          checkSendStatus: vi.fn(async () => ({ state: 'pending' })),
        },
      });

      const { mgr } = createManager('sendToken', handlers, {
        type: 'send',
        operationId: 'op-456',
        token: null,
      });

      await mgr.execute('checkStatus');

      expect(notifications).toContainEqual({
        event: 'onSendStatusChecked',
        args: [{ operationId: 'op-456', state: 'pending', redeemed: false }],
      });
    });

    it('does nothing without operationId', async () => {
      const { handlers, ops } = createMockConfig();
      const { mgr } = createManager('sendToken', handlers, {
        type: 'send',
        token: null,
      });

      await mgr.execute('checkStatus');
      expect(ops.checkSendStatus).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('calls rollbackSend and notifies on success', async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager('sendToken', handlers, {
        type: 'send',
        operationId: 'op-789',
        token: null,
      });

      await mgr.execute('cancel');

      expect(ops.rollbackSend).toHaveBeenCalledWith('op-789');
      expect(notifications).toContainEqual({
        event: 'onSendCancelled',
        args: [{ operationId: 'op-789' }],
      });
    });

    it('blocks cancellation while offline', async () => {
      const { handlers, ops, notifications } = createMockConfig({
        getOffline: () => true,
      });
      const { mgr } = createManager('sendToken', handlers, {
        type: 'send',
        operationId: 'op-offline',
        token: null,
      });

      await mgr.execute('cancel');

      expect(ops.rollbackSend).not.toHaveBeenCalled();
      expect(notifications).toContainEqual({
        event: 'onSendCancelFailed',
        args: [
          {
            operationId: 'op-offline',
            message: 'Cancel transaction is not possible while offline.',
            offline: true,
          },
        ],
      });
    });

    it('notifies onSendCancelFailed on error', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackSend: vi.fn(async () => {
            throw new Error('Cannot rollback');
          }),
        },
      });

      const { mgr } = createManager('sendToken', handlers, {
        type: 'send',
        operationId: 'op-fail',
        token: null,
      });

      await mgr.execute('cancel');

      expect(notifications).toContainEqual({
        event: 'onSendCancelFailed',
        args: [{ operationId: 'op-fail', message: 'Cannot rollback', mintUnreachable: false }],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// receiveToken
// ---------------------------------------------------------------------------

describe('receiveToken default handlers', () => {
  const VALID_TOKEN = {
    mint: MINT1,
    proofs: [
      {
        amount: 1,
        secret: 'test-secret-string',
        C: '02' + '0'.repeat(64),
        id: '00' + '0'.repeat(14),
      },
    ],
    unit: 'sat',
  };

  function tokenEntry() {
    return {
      id: 'receive-preview-1',
      type: 'receive',
      mintUrl: MINT1,
      amount: 1,
      unit: 'sat',
      token: VALID_TOKEN,
    };
  }

  describe('redeem — happy path', () => {
    it('calls executeReceive and notifies on success', async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager('receiveToken', handlers, tokenEntry());

      await mgr.execute('redeem');

      expect(ops.isMintTrusted).toHaveBeenCalledWith(MINT1);
      expect(ops.executeReceive).toHaveBeenCalled();
      expect(notifications.find((n) => n.event === 'onReceiveProcessing')).toBeTruthy();
      expect(notifications.find((n) => n.event === 'onReceiveConfirmed')).toBeTruthy();
    });

    it('notification sequence: onReceiveProcessing → onReceiveConfirmed → onTransactionCreated', async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager('receiveToken', handlers, tokenEntry());

      await mgr.execute('redeem');

      const events = notifications.map((n) => n.event);
      expect(events).toEqual(['onReceiveProcessing', 'onReceiveConfirmed', 'onTransactionCreated']);
    });

    it('onReceiveProcessing carries id, mintUrl, amount, unit', async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager('receiveToken', handlers, tokenEntry());

      await mgr.execute('redeem');

      const processing = notifications.find((n) => n.event === 'onReceiveProcessing');
      expect(processing!.args[0]).toMatchObject({
        id: 'receive-preview-1',
        mintUrl: MINT1,
        amount: 1,
        unit: 'sat',
      });
    });

    it('onReceiveConfirmed carries historyEntry', async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager('receiveToken', handlers, tokenEntry());

      await mgr.execute('redeem');

      const confirmed = notifications.find((n) => n.event === 'onReceiveConfirmed');
      const data = confirmed!.args[0] as Record<string, unknown>;
      expect(data.historyEntry).toEqual(expect.any(String));
      expect(data.id).toBe('receive-preview-1');
    });

    it('onTransactionCreated carries type=receive', async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager('receiveToken', handlers, tokenEntry());

      await mgr.execute('redeem');

      const txCreated = notifications.find((n) => n.event === 'onTransactionCreated');
      expect(txCreated!.args[0]).toMatchObject({
        type: 'receive',
        mintUrl: MINT1,
      });
    });

    it('updates entry with real history data', async () => {
      const realEntry = { id: 'rx-real', type: 'receive', mintUrl: MINT1, amount: 1 };
      const { handlers } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => ({
            historyEntry: JSON.stringify(realEntry),
          })),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr, setEntry } = createManager('receiveToken', handlers, tokenEntry());
      await mgr.execute('redeem');

      expect(setEntry).toHaveBeenCalledWith(realEntry);
    });

    it('calls linkTransaction when available', async () => {
      const realEntry = { id: 'rx-link', type: 'receive', mintUrl: MINT1, amount: 1 };
      const { handlers, ops } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => ({
            historyEntry: JSON.stringify(realEntry),
          })),
          isMintTrusted: vi.fn(async () => true),
          linkTransaction: vi.fn(),
        },
      });

      const { mgr } = createManager('receiveToken', handlers, tokenEntry());
      await mgr.execute('redeem');

      expect(ops.linkTransaction).toHaveBeenCalled();
    });
  });

  describe('redeem — untrusted mint', () => {
    it('calls machine.reviewMint instead of receiving', async () => {
      const { handlers, ops, machine } = createMockConfig({
        operations: {
          isMintTrusted: vi.fn(async () => false),
        },
      });

      const entry = tokenEntry();
      const { mgr } = createManager('receiveToken', handlers, entry);
      await mgr.execute('redeem');

      expect(machine.reviewMint).toHaveBeenCalled();
      expect(ops.executeReceive).not.toHaveBeenCalled();
    });
  });

  describe('redeem — failure', () => {
    it('notifies onReceiveFailed and re-throws', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => {
            throw new Error('Token already spent');
          }),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr } = createManager('receiveToken', handlers, tokenEntry());

      await expect(mgr.execute('redeem')).rejects.toThrow('Token already spent');
      expect(notifications.find((n) => n.event === 'onReceiveFailed')).toBeTruthy();
    });

    it('notification sequence on failure: onReceiveProcessing → onReceiveFailed (no confirmed/txCreated)', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          executeReceive: vi.fn(async () => {
            throw new Error('Already spent');
          }),
          isMintTrusted: vi.fn(async () => true),
        },
      });

      const { mgr } = createManager('receiveToken', handlers, tokenEntry());
      await expect(mgr.execute('redeem')).rejects.toThrow();

      const events = notifications.map((n) => n.event);
      expect(events).toEqual(['onReceiveProcessing', 'onReceiveFailed']);
    });
  });
});

// ---------------------------------------------------------------------------
// meltQuote
// ---------------------------------------------------------------------------

describe('meltQuote default handlers', () => {
  describe('pay', () => {
    it('delegates to machine.confirmMelt', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('meltQuote', handlers, {
        type: 'melt',
        quoteId: 'q-1',
        state: 'UNPAID',
      });

      await mgr.execute('pay');
      expect(machine.confirmMelt).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('calls rollbackMelt and notifies on success', async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager('meltQuote', handlers, {
        type: 'melt',
        quoteId: 'q-cancel',
        metadata: { operationId: 'melt-op-1' },
      });

      await mgr.execute('cancel');

      expect(ops.rollbackMelt).toHaveBeenCalledWith('melt-op-1');
      expect(notifications).toContainEqual({
        event: 'onMeltCancelled',
        args: [{ operationId: 'melt-op-1' }],
      });
    });

    it('falls back to quoteId when no operationId', async () => {
      const { handlers, ops } = createMockConfig();
      const { mgr } = createManager('meltQuote', handlers, {
        type: 'melt',
        quoteId: 'q-fallback',
      });

      await mgr.execute('cancel');
      expect(ops.rollbackMelt).toHaveBeenCalledWith('q-fallback');
    });

    it('silently ignores "not found" errors', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackMelt: vi.fn(async () => {
            throw new Error('No melt operation found');
          }),
        },
      });

      const { mgr } = createManager('meltQuote', handlers, {
        type: 'melt',
        quoteId: 'q-gone',
      });

      await mgr.execute('cancel');
      expect(notifications.find((n) => n.event === 'onMeltCancelFailed')).toBeFalsy();
    });

    it('notifies on non-ignorable errors', async () => {
      const { handlers, notifications } = createMockConfig({
        operations: {
          rollbackMelt: vi.fn(async () => {
            throw new Error('Network timeout');
          }),
        },
      });

      const { mgr } = createManager('meltQuote', handlers, {
        type: 'melt',
        quoteId: 'q-err',
      });

      await mgr.execute('cancel');
      expect(notifications.find((n) => n.event === 'onMeltCancelFailed')).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// paymentRequest
// ---------------------------------------------------------------------------

describe('paymentRequest default handlers', () => {
  describe('confirm', () => {
    it('delegates to machine.confirmPaymentRequest', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('paymentRequest', handlers, {
        type: 'send',
        metadata: { paymentRequest: 'pr-1' },
      });

      await mgr.execute('confirm');
      expect(machine.confirmPaymentRequest).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('calls navigation.goBack', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('paymentRequest', handlers, {
        type: 'send',
      });

      await mgr.execute('cancel');
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// receive
// ---------------------------------------------------------------------------

describe('receive default handlers', () => {
  const receiveEntry = {
    type: 'receive',
    unit: 'sat',
    selectedMintUrl: MINT1,
  };

  describe('paste', () => {
    it('delegates to machine.scan', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('receive', handlers, receiveEntry);

      await mgr.execute('paste');
      expect(machine.scan).toHaveBeenCalled();
    });
  });

  describe('fixedAmount', () => {
    it('delegates to machine.startReceiveLightning', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('receive', handlers, receiveEntry);

      await mgr.execute('fixedAmount');
      expect(machine.startReceiveLightning).toHaveBeenCalled();
    });
  });

  describe('scanQr', () => {
    it('calls navigation.scanQr with receive context', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('receive', handlers, receiveEntry);

      await mgr.execute('scanQr');
      expect(navigation.scanQr).toHaveBeenCalledWith({ unit: 'sat', context: 'receive' });
    });
  });

  describe('changeNpcMint', () => {
    it('delegates to machine.requestMintSelector with npc scope', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('receive', handlers, receiveEntry);

      await mgr.execute('changeNpcMint');
      expect(machine.requestMintSelector).toHaveBeenCalledWith({ scope: 'npc' });
    });
  });
});

// ---------------------------------------------------------------------------
// mintInfo
// ---------------------------------------------------------------------------

describe('mintInfo default handlers', () => {
  describe('trust', () => {
    it('calls trustMint and notifies', async () => {
      const { handlers, ops, notifications } = createMockConfig();
      const { mgr } = createManager('mintInfo', handlers, {
        mintUrl: MINT1,
        fromAccepter: true,
      });

      await mgr.execute('trust');

      expect(ops.trustMint).toHaveBeenCalledWith(MINT1);
      expect(notifications).toContainEqual({
        event: 'onMintTrustedFromScreen',
        args: [{ mintUrl: MINT1, fromAccepter: true }],
      });
    });

    it('sets fromAccepter false when not present', async () => {
      const { handlers, notifications } = createMockConfig();
      const { mgr } = createManager('mintInfo', handlers, {
        mintUrl: MINT1,
      });

      await mgr.execute('trust');

      expect(notifications).toContainEqual({
        event: 'onMintTrustedFromScreen',
        args: [{ mintUrl: MINT1, fromAccepter: false }],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// mintSelector
// ---------------------------------------------------------------------------

describe('mintSelector default handlers', () => {
  describe('select', () => {
    it('delegates to machine.changeMint', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('mintSelector', handlers, {
        scope: 'selected',
      });

      await mgr.execute('select', { mintUrl: MINT1 });
      expect(machine.changeMint).toHaveBeenCalledWith(MINT1, { scope: 'selected' });
    });
  });

  describe('getInfo', () => {
    it('calls buildMintReviewInfo and navigates to mintInfo', async () => {
      const { handlers, ops, navigation } = createMockConfig();
      const { mgr } = createManager('mintSelector', handlers, {});

      await mgr.execute('getInfo', { mintUrl: MINT1 });

      expect(ops.buildMintReviewInfo).toHaveBeenCalledWith(MINT1, undefined);
      expect(navigation.mintInfo).toHaveBeenCalled();
    });

    it('navigates with bare mintUrl when buildMintReviewInfo is unavailable', async () => {
      const { handlers, navigation } = createMockConfig({
        operations: { buildMintReviewInfo: undefined },
      });
      const { mgr } = createManager('mintSelector', handlers, {});

      await mgr.execute('getInfo', { mintUrl: MINT1 });

      const call = (navigation.mintInfo as MockFn).mock.calls[0];
      const parsed = JSON.parse(call[0]);
      expect(parsed.mintUrl).toBe(MINT1);
    });
  });

  describe('addMint', () => {
    it('calls navigation.addMint', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('mintSelector', handlers, {});

      await mgr.execute('addMint');
      expect(navigation.addMint).toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    it('calls navigation.goBack', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('mintSelector', handlers, {});

      await mgr.execute('cancel');
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// amountEntry
// ---------------------------------------------------------------------------

describe('amountEntry default handlers', () => {
  describe('cancel', () => {
    it('calls navigation.goBack', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        destination: 'sendEcash',
      });

      await mgr.execute('cancel');
      expect(navigation.goBack).toHaveBeenCalled();
    });
  });

  describe('next', () => {
    it('delegates to machine.enterAmount', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 100,
        selectedMintUrl: MINT1,
        destination: 'sendEcash',
      });

      await mgr.execute('next');
      expect(machine.enterAmount).toHaveBeenCalledWith(100, MINT1, {
        destination: 'sendEcash',
        meltTarget: undefined,
        recipientPubkey: undefined,
        amountEntryDisplay: {
          inputMode: 'sat',
          rawInput: '',
          fiatCurrency: null,
          fiatSymbol: null,
          btcPrice: 0,
          displayFiat: null,
          displaySats: 100,
          autoOptimized: false,
        },
      });
    });

    it('carries amount-entry display metadata to machine.enterAmount', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 20,
        selectedMintUrl: MINT1,
        destination: 'sendEcash',
        inputMode: 'fiat',
        rawInput: '0.01',
        fiatCurrency: 'usd',
        fiatSymbol: '$',
        btcPrice: 47_619,
        displayFiat: 0.01,
        displaySats: 20,
        autoOptimized: true,
      });

      await mgr.execute('next');
      expect(machine.enterAmount).toHaveBeenCalledWith(20, MINT1, {
        destination: 'sendEcash',
        meltTarget: undefined,
        recipientPubkey: undefined,
        amountEntryDisplay: {
          inputMode: 'fiat',
          rawInput: '0.01',
          fiatCurrency: 'usd',
          fiatSymbol: '$',
          btcPrice: 47_619,
          displayFiat: 0.01,
          displaySats: 20,
          autoOptimized: true,
        },
      });
    });

    it('forwards recipientPubkey from the entry to machine.enterAmount', async () => {
      const { handlers, machine } = createMockConfig();
      const recipientPubkey = 'a'.repeat(64);
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 100,
        selectedMintUrl: MINT1,
        destination: 'sendEcash',
        recipientPubkey,
      });

      await mgr.execute('next');
      expect(machine.enterAmount).toHaveBeenCalledWith(100, MINT1, {
        destination: 'sendEcash',
        meltTarget: undefined,
        recipientPubkey,
        amountEntryDisplay: expect.any(Object),
      });
    });

    it('prioritizes per-call recipient identity over entry identity', async () => {
      const { handlers, machine } = createMockConfig();
      const entryProfile = {
        displayName: 'Entry Alice',
        avatarUrl: null,
        nip05: 'entry@example.com',
      };
      const ctxProfile = {
        displayName: 'Fresh Alice',
        avatarUrl: 'https://example.com/alice.png',
        nip05: 'fresh@example.com',
      };
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 100,
        selectedMintUrl: MINT1,
        destination: 'sendEcash',
        recipientPubkey: 'a'.repeat(64),
        recipientProfile: entryProfile,
      });

      await mgr.execute('next', {
        recipientPubkey: 'b'.repeat(64),
        recipientProfile: ctxProfile,
      });

      expect(machine.enterAmount).toHaveBeenCalledWith(100, MINT1, {
        destination: 'sendEcash',
        meltTarget: undefined,
        recipientPubkey: 'b'.repeat(64),
        recipientProfile: ctxProfile,
        amountEntryDisplay: expect.any(Object),
      });
    });

    it('switches send-money to lightning with recipient identity intact', async () => {
      const { handlers, machine } = createMockConfig();
      const recipientProfile = {
        displayName: 'Alice',
        avatarUrl: 'https://example.com/alice.png',
        nip05: 'alice@example.com',
      };
      const recipientPubkey = 'a'.repeat(64);
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 100,
        selectedMintUrl: MINT1,
        destination: 'sendEcash',
        meltTarget: 'alice@example.com',
        recipientPubkey,
        recipientProfile,
      });

      await mgr.execute('next', { variantId: 'lightning' });

      expect(machine.enterAmount).toHaveBeenCalledWith(100, MINT1, {
        destination: 'meltQuote',
        meltQuoteMethod: 'bolt11',
        meltTarget: 'alice@example.com',
        recipientPubkey,
        recipientProfile,
        amountEntryDisplay: expect.any(Object),
      });
    });

    it('does not enter unsupported onchain receive from the default next handler', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 500,
        selectedMintUrl: MINT1,
        destination: 'mintQuote',
        unit: 'sat',
        methodContext: {
          trustedMintUrls: [MINT1],
          mintBalances: { [MINT1]: 0 },
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
            {
              mintUrl: MINT1,
              mintInfo: {
                nuts: {
                  '4': {
                    methods: [
                      { method: 'bolt11', unit: 'sat', min_amount: 1 },
                      { method: 'onchain', unit: 'sat', min_amount: 1_000 },
                    ],
                  },
                },
              },
            },
          ]),
        },
      });

      await mgr.execute('next', { variantId: 'onchain' });

      expect(machine.enterAmount).not.toHaveBeenCalled();
    });

    it('does not enter unsupported onchain receive even when an alternate advertises it', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 500,
        selectedMintUrl: MINT1,
        destination: 'mintQuote',
        unit: 'sat',
        methodContext: {
          trustedMintUrls: [MINT1, MINT2],
          mintBalances: { [MINT1]: 0, [MINT2]: 0 },
          mintMethodCapabilities: deriveMintMethodCapabilityMapFromTrustedMints([
            {
              mintUrl: MINT1,
              mintInfo: {
                nuts: {
                  '4': {
                    methods: [
                      { method: 'bolt11', unit: 'sat', min_amount: 1 },
                      { method: 'onchain', unit: 'sat', min_amount: 1_000 },
                    ],
                  },
                },
              },
            },
            {
              mintUrl: MINT2,
              mintInfo: {
                nuts: {
                  '4': { methods: [{ method: 'onchain', unit: 'sat', min_amount: 100 }] },
                },
              },
            },
          ]),
        },
      });

      await mgr.execute('next', { variantId: 'onchain' });

      expect(machine.enterAmount).not.toHaveBeenCalled();
    });

    it('does nothing when effectiveSatAmount is 0', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 0,
        selectedMintUrl: MINT1,
        destination: 'sendEcash',
      });

      await mgr.execute('next');
      expect(machine.enterAmount).not.toHaveBeenCalled();
    });

    it('does nothing without destination', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        effectiveSatAmount: 100,
        selectedMintUrl: MINT1,
      });

      await mgr.execute('next');
      expect(machine.enterAmount).not.toHaveBeenCalled();
    });
  });

  describe('paste', () => {
    it('delegates to machine.scan for sendEcash', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        destination: 'sendEcash',
      });

      await mgr.execute('paste');
      expect(machine.scan).toHaveBeenCalled();
    });

    it('does nothing for non-sendEcash destinations', async () => {
      const { handlers, machine } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        destination: 'mintQuote',
      });

      await mgr.execute('paste');
      expect(machine.scan).not.toHaveBeenCalled();
    });
  });

  describe('scanQr', () => {
    it('calls navigation.scanQr for sendEcash', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        destination: 'sendEcash',
        unit: 'sat',
      });

      await mgr.execute('scanQr');
      expect(navigation.scanQr).toHaveBeenCalledWith({ unit: 'sat', context: 'amount' });
    });

    it('does nothing for non-sendEcash destinations', async () => {
      const { handlers, navigation } = createMockConfig();
      const { mgr } = createManager('amountEntry', handlers, {
        destination: 'mintQuote',
        unit: 'sat',
      });

      await mgr.execute('scanQr');
      expect(navigation.scanQr).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Three-tier fallback
// ---------------------------------------------------------------------------

describe('three-tier fallback', () => {
  it('wallet override takes priority over default handler', async () => {
    const walletHandler = vi.fn();
    const { handlers } = createMockConfig();

    let mgrRef: ScreenActionManager<'mintInfo'> | null = null;
    const mgr: ScreenActionManager<'mintInfo'> = createScreenActionManager({
      screenType: 'mintInfo',
      handlers: { trust: walletHandler },
      defaultHandlers: handlers.mintInfo,
      getContext: (): ScreenActionContext => ({
        entry: mgrRef?.getEntry() ?? {},
        manager: null,
        setEntry: () => {},
      }),
    });
    mgrRef = mgr;
    mgr.setEntry({ mintUrl: MINT1 });

    await mgr.execute('trust');

    expect(walletHandler).toHaveBeenCalled();
  });

  it('default handler is used when no wallet handler exists', async () => {
    const { handlers, ops } = createMockConfig();

    let mgrRef: ScreenActionManager<'mintInfo'> | null = null;
    const mgr: ScreenActionManager<'mintInfo'> = createScreenActionManager({
      screenType: 'mintInfo',
      handlers: {},
      defaultHandlers: handlers.mintInfo,
      getContext: (): ScreenActionContext => ({
        entry: mgrRef?.getEntry() ?? {},
        manager: null,
        setEntry: () => {},
      }),
    });
    mgrRef = mgr;
    mgr.setEntry({ mintUrl: MINT1 });

    await mgr.execute('trust');

    expect(ops.trustMint).toHaveBeenCalledWith(MINT1);
  });
});
