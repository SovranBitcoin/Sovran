/**
 * Standalone send machine unit tests.
 *
 * Tests exercise the machine in isolation by providing mock actors via
 * machine.provide(). The controller module is mocked so native/ESM
 * dependencies (coco, expo-network, cashu-ts) are never imported.
 */

// Mock the controller before any imports that touch it
jest.mock('@/features/send/controller/SendController', () => ({
  sendController: {
    checkBalance: jest.fn(),
    checkConnectivity: jest.fn(),
    executeSend: jest.fn(),
    resolveOffline: jest.fn(),
    getBtcPrice: jest.fn().mockReturnValue(null),
    getSelectedMint: jest.fn(),
    setForceOffline: jest.fn(),
    getForceOffline: jest.fn().mockReturnValue(false),
  },
}));

import { createActor, fromPromise, waitFor } from 'xstate';

import { sendMachine } from '@/features/send/machine/sendMachine';
import type {
  CheckBalanceOutput,
  CheckConnectivityOutput,
  ExecuteSendOutput,
  OfflineResolutionResult,
} from '@/features/send/machine/sendMachine.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successActor<T>(value: T) {
  return fromPromise(async () => value);
}

function failActor(message: string) {
  return fromPromise(async () => {
    throw new Error(message);
  });
}

const MINT_URL = 'https://mint.example';

function makeMachine(overrides: {
  checkBalance?: any;
  checkConnectivity?: any;
  executeSend?: any;
  resolveOffline?: any;
}) {
  return sendMachine.provide({
    actors: {
      checkBalance: overrides.checkBalance ?? successActor<CheckBalanceOutput>({ balance: 1000 }),
      checkConnectivity:
        overrides.checkConnectivity ?? successActor<CheckConnectivityOutput>({ isOnline: true }),
      executeSend:
        overrides.executeSend ??
        successActor<ExecuteSendOutput>({
          token: 'cashuBtest-token',
          operationId: 'op-1',
          historyEntryJson: '{"id":"entry-1","type":"send","amount":100}',
        }),
      resolveOffline:
        overrides.resolveOffline ??
        successActor<OfflineResolutionResult>({
          type: 'exact',
          amount: 100,
        }),
    },
  });
}

function startMachine(
  machine: ReturnType<typeof makeMachine>,
  input?: { mintUrl?: string; amountSat?: number; denomination?: 'sat' | 'fiat' }
) {
  const actor = createActor(machine, {
    input: {
      mintUrl: input?.mintUrl ?? MINT_URL,
      amountSat: input?.amountSat ?? 100,
      denomination: input?.denomination ?? 'sat',
    },
  });
  actor.start();
  return actor;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendMachine', () => {
  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('starts in editingAmount', () => {
    const machine = makeMachine({});
    const actor = createActor(machine, { input: { mintUrl: MINT_URL, amountSat: 100 } });
    actor.start();
    expect(actor.getSnapshot().value).toBe('editingAmount');
    actor.stop();
  });

  it('initializes context from input', () => {
    const machine = makeMachine({});
    const actor = createActor(machine, {
      input: { mintUrl: MINT_URL, amountSat: 42, denomination: 'fiat', fiatAmount: 0.5 },
    });
    actor.start();
    const ctx = actor.getSnapshot().context;
    expect(ctx.mintUrl).toBe(MINT_URL);
    expect(ctx.amountSat).toBe(42);
    expect(ctx.denomination).toBe('fiat');
    expect(ctx.fiatAmount).toBe(0.5);
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // editingAmount
  // -----------------------------------------------------------------------

  it('SET_AMOUNT updates context', () => {
    const machine = makeMachine({});
    const actor = startMachine(machine);
    actor.send({ type: 'SET_AMOUNT', amountSat: 200, fiatAmount: 1.5 });
    const ctx = actor.getSnapshot().context;
    expect(ctx.amountSat).toBe(200);
    expect(ctx.fiatAmount).toBe(1.5);
    actor.stop();
  });

  it('SET_DENOMINATION updates context', () => {
    const machine = makeMachine({});
    const actor = startMachine(machine);
    actor.send({ type: 'SET_DENOMINATION', denomination: 'fiat' });
    expect(actor.getSnapshot().context.denomination).toBe('fiat');
    actor.stop();
  });

  it('SET_MINT updates context', () => {
    const machine = makeMachine({});
    const actor = startMachine(machine);
    actor.send({ type: 'SET_MINT', mintUrl: 'https://other.mint' });
    expect(actor.getSnapshot().context.mintUrl).toBe('https://other.mint');
    actor.stop();
  });

  it('NEXT is blocked when amount is 0', () => {
    const machine = makeMachine({});
    const actor = startMachine(machine, { amountSat: 0 });
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('editingAmount');
    actor.stop();
  });

  it('NEXT is blocked when mint is null', () => {
    const machine = makeMachine({});
    const actor = createActor(machine, { input: { amountSat: 100 } });
    actor.start();
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('editingAmount');
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Happy path: online send
  // -----------------------------------------------------------------------

  it('online send: editingAmount → success', async () => {
    const machine = makeMachine({});
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'success', { timeout: 2000 });
    expect(snap.value).toBe('success');
    expect(snap.context.token).toBe('cashuBtest-token');
    expect(snap.context.operationId).toBe('op-1');
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Insufficient balance → mintSelect
  // -----------------------------------------------------------------------

  it('insufficient balance routes to mintSelect', async () => {
    const machine = makeMachine({
      checkBalance: successActor<CheckBalanceOutput>({ balance: 10 }),
    });
    const actor = startMachine(machine, { amountSat: 100 });
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'mintSelect', { timeout: 2000 });
    expect(snap.value).toBe('mintSelect');
    expect(snap.context.mintBalance).toBe(10);
    actor.stop();
  });

  it('MINT_SELECTED from mintSelect re-validates balance', async () => {
    let callCount = 0;
    const machine = makeMachine({
      checkBalance: fromPromise(async (): Promise<CheckBalanceOutput> => {
        callCount++;
        return { balance: callCount === 1 ? 10 : 1000 };
      }),
    });
    const actor = startMachine(machine, { amountSat: 100 });
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'mintSelect', { timeout: 2000 });
    actor.send({ type: 'MINT_SELECTED', mintUrl: 'https://other.mint' });

    const snap = await waitFor(
      actor,
      (s) => s.value !== 'validatingBalance' && s.value !== 'mintSelect',
      { timeout: 2000 }
    );
    expect(snap.context.mintUrl).toBe('https://other.mint');
    expect(snap.context.mintBalance).toBe(1000);
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Offline path: exact match
  // -----------------------------------------------------------------------

  it('offline exact match goes through sendingToken → success', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'exact',
        amount: 100,
      }),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'success', { timeout: 2000 });
    expect(snap.value).toBe('success');
    expect(snap.context.resolvedAmount).toBe(100);
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Offline path: fiat range match
  // -----------------------------------------------------------------------

  it('offline fiat-range match goes through sendingToken → success', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'fiat-range',
        amount: 95,
      }),
    });
    const actor = startMachine(machine, { denomination: 'fiat', amountSat: 100 });
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'success', { timeout: 2000 });
    expect(snap.context.resolvedAmount).toBe(95);
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Offline path: impossible → adjustmentPrompt
  // -----------------------------------------------------------------------

  it('impossible offline resolution routes to adjustmentPrompt', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'impossible',
        suggestions: {
          isRequestedAmountSendableOffline: false,
          roundDownAmount: 80,
          roundUpAmount: 120,
          totalReadyBalance: 500,
        },
        fiatSuggestions: null,
      }),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'adjustmentPrompt', {
      timeout: 2000,
    });
    expect(snap.context.offlineSuggestions?.roundDownAmount).toBe(80);
    expect(snap.context.offlineSuggestions?.roundUpAmount).toBe(120);
    actor.stop();
  });

  it('ROUND_UP from adjustmentPrompt sends with rounded amount', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'impossible',
        suggestions: {
          isRequestedAmountSendableOffline: false,
          roundDownAmount: 80,
          roundUpAmount: 120,
          totalReadyBalance: 500,
        },
        fiatSuggestions: null,
      }),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'adjustmentPrompt', { timeout: 2000 });
    actor.send({ type: 'ROUND_UP' });

    const snap = await waitFor(actor, (s) => s.value === 'success', { timeout: 2000 });
    expect(snap.context.resolvedAmount).toBe(120);
    actor.stop();
  });

  it('ROUND_DOWN from adjustmentPrompt sends with rounded amount', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'impossible',
        suggestions: {
          isRequestedAmountSendableOffline: false,
          roundDownAmount: 80,
          roundUpAmount: 120,
          totalReadyBalance: 500,
        },
        fiatSuggestions: null,
      }),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'adjustmentPrompt', { timeout: 2000 });
    actor.send({ type: 'ROUND_DOWN' });

    const snap = await waitFor(actor, (s) => s.value === 'success', { timeout: 2000 });
    expect(snap.context.resolvedAmount).toBe(80);
    actor.stop();
  });

  it('CANCEL from adjustmentPrompt returns to editingAmount', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'impossible',
        suggestions: {
          isRequestedAmountSendableOffline: false,
          roundDownAmount: null,
          roundUpAmount: null,
          totalReadyBalance: 0,
        },
        fiatSuggestions: null,
      }),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'adjustmentPrompt', { timeout: 2000 });
    actor.send({ type: 'CANCEL' });
    expect(actor.getSnapshot().value).toBe('editingAmount');
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Online send failure → offline fallback
  // -----------------------------------------------------------------------

  it('online send failure falls back to offline resolution', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: true }),
      executeSend: failActor('Mint unreachable'),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'exact',
        amount: 100,
      }),
    });

    // executeSend fails on the first call (onlineSend), but the machine
    // falls back to offlineResolution which succeeds. It then invokes
    // executeSend again for sendingToken — override so the second call works.
    let callCount = 0;
    const machineWithFallback = machine.provide({
      actors: {
        executeSend: fromPromise(async (): Promise<ExecuteSendOutput> => {
          callCount++;
          if (callCount === 1) throw new Error('Mint unreachable');
            return { token: 'offline-token', operationId: 'op-offline', historyEntryJson: null };
        }),
      },
    });

    const actor = startMachine(machineWithFallback);
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'success', { timeout: 2000 });
    expect(snap.context.token).toBe('offline-token');
    expect(snap.context.resolvedAmount).toBe(100);
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Failure state: retry and cancel
  // -----------------------------------------------------------------------

  it('RETRY from failure re-validates balance', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'exact',
        amount: 100,
      }),
      executeSend: failActor('Send failed'),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    const failSnap = await waitFor(actor, (s) => s.value === 'failure', { timeout: 2000 });
    expect(failSnap.context.error?.message).toBe('Send failed');

    actor.send({ type: 'RETRY' });
    expect(actor.getSnapshot().value).toBe('validatingBalance');
    expect(actor.getSnapshot().context.error).toBeNull();
    actor.stop();
  });

  it('CANCEL from failure returns to editingAmount', async () => {
    const machine = makeMachine({
      checkConnectivity: successActor<CheckConnectivityOutput>({ isOnline: false }),
      resolveOffline: successActor<OfflineResolutionResult>({
        type: 'exact',
        amount: 100,
      }),
      executeSend: failActor('Send failed'),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    await waitFor(actor, (s) => s.value === 'failure', { timeout: 2000 });
    actor.send({ type: 'CANCEL' });
    expect(actor.getSnapshot().value).toBe('editingAmount');
    expect(actor.getSnapshot().context.error).toBeNull();
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Balance check failure → failure state
  // -----------------------------------------------------------------------

  it('balance check failure goes to failure', async () => {
    const machine = makeMachine({
      checkBalance: failActor('Network error'),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(actor, (s) => s.value === 'failure', { timeout: 2000 });
    expect(snap.context.error?.code).toBe('BALANCE_CHECK_FAILED');
    actor.stop();
  });

  // -----------------------------------------------------------------------
  // Connectivity check failure → offline fallback
  // -----------------------------------------------------------------------

  it('connectivity check error falls back to offline', async () => {
    const machine = makeMachine({
      checkConnectivity: failActor('NetInfo failed'),
    });
    const actor = startMachine(machine);
    actor.send({ type: 'NEXT' });

    const snap = await waitFor(
      actor,
      (s) => s.value !== 'validatingBalance' && s.value !== 'checkingConnectivity',
      { timeout: 2000 }
    );
    expect(snap.context.isOffline).toBe(true);
    actor.stop();
  });
});
