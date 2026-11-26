/** @jest-environment node */

import { startRecoveryRun } from '@/features/settings/lib/recoveryRun';
import { registerProfileSwitchBoundary } from '@/shared/lib/account/accountRegistry';
import { CocoManager } from '@/shared/lib/cashu/manager';
import { deferWhileRecovering, isRecoverySuppressed } from '@/shared/lib/cashu/recoverySuppression';
import { runInProcessProfileSwitch } from '@/shared/lib/profile/inProcessProfileSwitch';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { getInstance: jest.fn() },
}));
jest.mock('@/shared/lib/cashu/managerInternals', () => ({}));
jest.mock('@/shared/lib/logger', () => ({
  cashuLog: { info: jest.fn(), warn: jest.fn() },
  mintUrlLogFields: jest.fn(),
}));

function deferredRead() {
  let settle!: (value: []) => void;
  const pending = new Promise<[]>((resolve) => {
    settle = resolve;
  });
  return { pending, settle: () => settle([]) };
}

function startWithPendingRead() {
  const read = deferredRead();
  const addMint = jest.fn().mockResolvedValue({ keysets: [] });
  const byMint = jest.fn().mockResolvedValue({});
  jest.mocked(CocoManager.getInstance).mockReturnValue({
    ops: {
      mint: { listPending: jest.fn().mockReturnValueOnce(read.pending).mockResolvedValue([]) },
    },
    mint: { addMint },
    wallet: { balances: { byMint } },
  } as unknown as ReturnType<typeof CocoManager.getInstance>);
  const input = {
    knownMintUrls: ['https://mint.example'],
    probeCandidates: [],
    loadMints: jest.fn().mockResolvedValue(undefined),
  };
  const publish = jest.fn();
  const run = startRecoveryRun(input, { phase: 'idle' }, publish);
  return { ...read, run, input, publish, addMint, byMint };
}

it('discards outgoing refreshes and keeps late recovery completions out of the current session', async () => {
  let account = 'A';
  const unregister = registerProfileSwitchBoundary({
    suspend: async () => {},
    resume: async () => {},
  });
  const switchTo = (target: string) =>
    runInProcessProfileSwitch({
      cleanupCoco: async () => {},
      flipAccount: () => {
        account = target;
      },
    });
  try {
    const a = startWithPendingRead();
    expect(a.run.status).toBe('started');
    if (a.run.status !== 'started') throw new Error('A did not start');
    const flushA = jest.fn();
    expect(deferWhileRecovering('mints', flushA)).toBe(true);

    await switchTo('B');
    expect(account).toBe('B');
    expect(isRecoverySuppressed()).toBe(false);
    const b = startWithPendingRead();
    expect(b.run.status).toBe('started');
    if (b.run.status !== 'started') throw new Error('B did not start');
    const flushB = jest.fn();
    expect(deferWhileRecovering('mints', flushB)).toBe(true);

    a.settle();
    expect((await a.run.done).end).toEqual({ kind: 'stopped' });
    expect(a.addMint).not.toHaveBeenCalled();
    expect(a.input.loadMints).not.toHaveBeenCalled();
    expect(a.publish).not.toHaveBeenCalled();
    expect(flushA).not.toHaveBeenCalled();
    expect(flushB).not.toHaveBeenCalled();
    expect(isRecoverySuppressed()).toBe(true);
    expect(startRecoveryRun(b.input, { phase: 'idle' }, jest.fn()).status).toBe('busy');

    await switchTo('A');
    expect(account).toBe('A');
    const nextA = startWithPendingRead();
    expect(nextA.run.status).toBe('started');
    if (nextA.run.status !== 'started') throw new Error('A did not restart');
    const flushNextA = jest.fn();
    expect(deferWhileRecovering('mints', flushNextA)).toBe(true);
    b.settle();
    expect((await b.run.done).end).toEqual({ kind: 'stopped' });
    expect(flushB).not.toHaveBeenCalled();
    expect(flushNextA).not.toHaveBeenCalled();

    nextA.settle();
    await nextA.run.done;
    expect(flushNextA).toHaveBeenCalledTimes(1);
    expect(isRecoverySuppressed()).toBe(false);
  } finally {
    unregister();
  }
});

it('waits for an admitted mint mutation before closing the outgoing wallet', async () => {
  const read = deferredRead();
  let finishAddMint!: (value: { keysets: [] }) => void;
  const addingMint = new Promise<{ keysets: [] }>((resolve) => {
    finishAddMint = resolve;
  });
  const addMint = jest.fn(() => addingMint);
  const byMint = jest.fn();
  jest.mocked(CocoManager.getInstance).mockReturnValue({
    ops: { mint: { listPending: jest.fn(() => read.pending) } },
    mint: { addMint },
    wallet: { balances: { byMint } },
  } as unknown as ReturnType<typeof CocoManager.getInstance>);
  const loadMints = jest.fn();
  const run = startRecoveryRun(
    { knownMintUrls: ['https://mint.example'], probeCandidates: [], loadMints },
    { phase: 'idle' },
    jest.fn()
  );
  if (run.status !== 'started') throw new Error('Recovery did not start');
  read.settle();
  await new Promise(setImmediate);
  expect(addMint).toHaveBeenCalledTimes(1);

  const unregister = registerProfileSwitchBoundary({
    suspend: async () => {},
    resume: async () => {},
  });
  const cleanupCoco = jest.fn().mockResolvedValue(undefined);
  const flipAccount = jest.fn();
  try {
    const switched = runInProcessProfileSwitch({ cleanupCoco, flipAccount });
    await new Promise(setImmediate);
    expect(cleanupCoco).not.toHaveBeenCalled();
    expect(flipAccount).not.toHaveBeenCalled();
    finishAddMint({ keysets: [] });
    await switched;

    expect((await run.done).end).toEqual({ kind: 'stopped' });
    expect(cleanupCoco).toHaveBeenCalledTimes(1);
    expect(flipAccount).toHaveBeenCalledTimes(1);
    expect(byMint).not.toHaveBeenCalled();
    expect(loadMints).not.toHaveBeenCalled();
    expect(isRecoverySuppressed()).toBe(false);
  } finally {
    unregister();
  }
});
