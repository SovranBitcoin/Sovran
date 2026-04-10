/**
 * DO NOT modify tests to make them pass.
 * Tests define expected behavior — they are the specification.
 * If a test fails, fix the implementation, not the test.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * core-factory.test.ts — createCocoPaymentUX + walletContextTracker
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Tests the framework-agnostic factory and wallet context tracker that form
 * the core of coco-payment-ux's integration layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCocoPaymentUX } from '../../src/core/createCocoPaymentUX';
import { createWalletContextTracker } from '../../src/core/walletContextTracker';

const MINT1 = 'https://mint1.example.com';
const MINT2 = 'https://mint2.example.com';

// ---------------------------------------------------------------------------
// Mock Manager
// ---------------------------------------------------------------------------

type EventHandler = (...args: any[]) => void;

function createMockManager() {
  const eventHandlers = new Map<string, Set<EventHandler>>();

  const manager = {
    mint: {
      getAllTrustedMints: vi.fn().mockResolvedValue([
        { mintUrl: MINT1 },
        { mintUrl: MINT2 },
      ]),
      isTrustedMint: vi.fn().mockResolvedValue(true),
      addMint: vi.fn(),
      getMintInfo: vi.fn().mockResolvedValue({ name: 'Test Mint' }),
    },
    wallet: {
      getBalances: vi.fn().mockResolvedValue({
        [MINT1]: 1000,
        [MINT2]: 500,
      }),
      send: vi.fn(),
      receive: vi.fn(),
      processPaymentRequest: vi.fn(),
      preparePaymentRequestTransaction: vi.fn(),
      handleHttpPaymentRequest: vi.fn(),
      handleInbandPaymentRequest: vi.fn(),
    },
    history: {
      getPaginatedHistory: vi.fn().mockResolvedValue([]),
    },
    send: {
      prepareSend: vi.fn(),
      executePreparedSend: vi.fn(),
      getOperation: vi.fn(),
      checkPendingOperation: vi.fn(),
      rollback: vi.fn(),
    },
    quotes: {
      createMintQuote: vi.fn(),
      prepareMeltBolt11: vi.fn(),
      executeMelt: vi.fn(),
      rollbackMelt: vi.fn(),
    },
    keyring: {
      getLatestKeyPair: vi.fn(),
      generateKeyPair: vi.fn(),
    },
    on: vi.fn((event: string, handler: EventHandler) => {
      if (!eventHandlers.has(event)) eventHandlers.set(event, new Set());
      eventHandlers.get(event)!.add(handler);
      return () => eventHandlers.get(event)?.delete(handler);
    }),
    // proofService is accessed via cast — same pattern as the real code
    proofService: {
      getReadyProofs: vi.fn().mockResolvedValue([
        { amount: 1 },
        { amount: 2 },
        { amount: 4 },
        { amount: 8 },
        { amount: 64 },
      ]),
    },
  };

  function emit(event: string, data?: any) {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      for (const handler of handlers) handler(data);
    }
  }

  return { manager: manager as any, emit };
}

// ---------------------------------------------------------------------------
// createCocoPaymentUX
// ---------------------------------------------------------------------------

describe('createCocoPaymentUX', () => {
  it('returns an instance with tracker, operations, and dispose', () => {
    const { manager } = createMockManager();
    const instance = createCocoPaymentUX({ manager });

    expect(instance.tracker).toBeDefined();
    expect(instance.getWalletContext).toBeDefined();
    expect(instance.subscribeWalletContext).toBeDefined();
    expect(instance.operations).toBeDefined();
    expect(instance.dispose).toBeDefined();

    instance.dispose();
  });

  it('operations include built-in wallet operations', () => {
    const { manager } = createMockManager();
    const instance = createCocoPaymentUX({ manager });
    const ops = instance.operations;

    // Core operations provided by defaultOperations
    expect(ops.executeSend).toBeDefined();
    expect(ops.executeMintQuote).toBeDefined();
    expect(ops.executeMelt).toBeDefined();
    expect(ops.executeReceive).toBeDefined();
    expect(ops.buildMintListItems).toBeDefined();
    expect(ops.buildMintReviewInfo).toBeDefined();
    expect(ops.checkSendStatus).toBeDefined();
    expect(ops.rollbackSend).toBeDefined();
    expect(ops.rollbackMelt).toBeDefined();
    expect(ops.isMintTrusted).toBeDefined();
    expect(ops.trustMint).toBeDefined();
    expect(ops.executeNfcSend).toBeDefined();

    instance.dispose();
  });

  it('does not include app-specific operations (linkTransaction, sendNostrDM)', () => {
    const { manager } = createMockManager();
    const instance = createCocoPaymentUX({ manager });

    // These are app-specific — not included in defaultOperations
    expect(instance.operations.linkTransaction).toBeUndefined();
    expect(instance.operations.sendNostrDM).toBeUndefined();

    instance.dispose();
  });

  it('dispose cleans up the tracker', () => {
    const { manager } = createMockManager();
    const instance = createCocoPaymentUX({ manager });

    expect(() => instance.dispose()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// WalletContextTracker
// ---------------------------------------------------------------------------

describe('createWalletContextTracker', () => {
  let mockManager: ReturnType<typeof createMockManager>;

  beforeEach(() => {
    mockManager = createMockManager();
  });

  it('auto-refreshes on creation from Manager state', async () => {
    const tracker = createWalletContextTracker(mockManager.manager);

    // The tracker calls refresh() in the constructor (async)
    // Wait for it to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    const ctx = tracker.getContext();
    expect(ctx.trustedMintUrls).toEqual([MINT1, MINT2]);
    expect(ctx.mintBalances).toEqual({ [MINT1]: 1000, [MINT2]: 500 });

    tracker.dispose();
  });

  it('refresh() populates proof amounts from proofService', async () => {
    const tracker = createWalletContextTracker(mockManager.manager);

    // Wait for constructor's auto-refresh to complete, then refresh again
    await new Promise((resolve) => setTimeout(resolve, 50));
    await tracker.refresh();

    const ctx = tracker.getContext();
    expect(ctx.proofAmounts[MINT1]).toEqual([1, 2, 4, 8, 64]);
    expect(ctx.proofAmounts[MINT2]).toEqual([1, 2, 4, 8, 64]);

    tracker.dispose();
  });

  it('reads preferredMintUrl from getPreferredMintUrl getter', async () => {
    let preferred: string | undefined = MINT1;
    const tracker = createWalletContextTracker(mockManager.manager, {
      getPreferredMintUrl: () => preferred,
    });
    await tracker.refresh();

    expect(tracker.getContext().preferredMintUrl).toBe(MINT1);

    preferred = undefined;
    expect(tracker.getContext().preferredMintUrl).toBeUndefined();

    preferred = MINT2;
    expect(tracker.getContext().preferredMintUrl).toBe(MINT2);

    tracker.dispose();
  });

  it('preferredMintUrl is undefined when no getter is provided', async () => {
    const tracker = createWalletContextTracker(mockManager.manager);
    await tracker.refresh();

    expect(tracker.getContext().preferredMintUrl).toBeUndefined();

    tracker.dispose();
  });

  it('unsubscribe stops notifications', () => {
    const tracker = createWalletContextTracker(mockManager.manager);
    const listener = vi.fn();
    const unsub = tracker.subscribe(listener);

    unsub();
    // Trigger an event — listener should not fire
    mockManager.emit('proofs:saved', {});
    expect(listener).not.toHaveBeenCalled();

    tracker.dispose();
  });

  it('refreshes on Manager proofs:saved event', async () => {
    const tracker = createWalletContextTracker(mockManager.manager);
    await tracker.refresh();

    // Change the mock data
    mockManager.manager.wallet.getBalances.mockResolvedValue({
      [MINT1]: 2000,
      [MINT2]: 500,
    });

    // Trigger Manager event
    mockManager.emit('proofs:saved', {});

    // Wait for async refresh
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(tracker.getContext().mintBalances[MINT1]).toBe(2000);

    tracker.dispose();
  });

  it('subscribes to all expected Manager events', () => {
    const tracker = createWalletContextTracker(mockManager.manager);
    const events = mockManager.manager.on.mock.calls.map((c: any[]) => c[0]);

    expect(events).toContain('proofs:saved');
    expect(events).toContain('proofs:state-changed');
    expect(events).toContain('proofs:deleted');
    expect(events).toContain('proofs:reserved');
    expect(events).toContain('proofs:released');
    expect(events).toContain('mint:added');
    expect(events).toContain('mint:trusted');
    expect(events).toContain('mint:untrusted');

    tracker.dispose();
  });

  it('dispose removes all event subscriptions', async () => {
    const tracker = createWalletContextTracker(mockManager.manager);

    // Wait for constructor's auto-refresh to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    tracker.dispose();

    // Change mock data — should not affect context since disposed
    mockManager.manager.wallet.getBalances.mockResolvedValue({
      [MINT1]: 9999,
      [MINT2]: 9999,
    });

    const listener = vi.fn();
    tracker.subscribe(listener);
    mockManager.emit('proofs:saved', {});

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Listener should not be called — event handlers were unsubscribed
    expect(listener).not.toHaveBeenCalled();
  });

  it('debounces concurrent refreshes', async () => {
    const tracker = createWalletContextTracker(mockManager.manager);

    // Wait for initial auto-refresh
    await new Promise((resolve) => setTimeout(resolve, 50));

    const callCountBefore = mockManager.manager.mint.getAllTrustedMints.mock.calls.length;

    // Trigger multiple events rapidly
    mockManager.emit('proofs:saved', {});
    mockManager.emit('proofs:saved', {});
    mockManager.emit('proofs:saved', {});

    await new Promise((resolve) => setTimeout(resolve, 100));

    const callCountAfter = mockManager.manager.mint.getAllTrustedMints.mock.calls.length;
    // Should have at most 2 additional calls (one active + one pending), not 3
    expect(callCountAfter - callCountBefore).toBeLessThanOrEqual(2);

    tracker.dispose();
  });
});

// ---------------------------------------------------------------------------
// createMachineFromInstance
// ---------------------------------------------------------------------------

describe('createMachineFromInstance', () => {
  it('creates a working machine from an instance', async () => {
    const { manager } = createMockManager();
    const { createMachineFromInstance } = await import('../../src/core/createCocoPaymentUX');

    const instance = createCocoPaymentUX({ manager });
    await instance.tracker.refresh();

    const machine = createMachineFromInstance({
      instance,
      handlers: {},
      getOffline: () => false,
      getLocale: () => 'en',
    });

    expect(machine).toBeDefined();
    expect(machine.getContext).toBeDefined();
    expect(machine.subscribe).toBeDefined();

    instance.dispose();
  });
});
