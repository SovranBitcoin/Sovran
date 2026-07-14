import { describe, expect, it, mock } from 'bun:test';

import type { Exec } from '../counterparties/cocod';
import type { CocodCommandResult } from '../funded/cocod';
import {
  CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
  connectUnlockedCurrentCocod,
  preflightCurrentCocod,
  type CocodProcessRunner,
} from './cocod-live';

const TOP_HELP = `Commands:
  status
  balance
  send
  receive
  mints
  npc
  x-cashu`;

function successfulSyncExec(commands: string[][]): Exec {
  return (args) => {
    commands.push([...args]);
    const command = args.slice(1).join(' ');
    if (command === '--version') return { code: 0, stdout: 'cocod 0.0.16\n', stderr: '' };
    if (command === '--help') return { code: 0, stdout: TOP_HELP, stderr: '' };
    if (command === 'send --help') {
      return { code: 0, stdout: 'Commands:\n  cashu\n  bolt11', stderr: '' };
    }
    if (command === 'receive --help') {
      return { code: 0, stdout: 'Commands:\n  cashu\n  bolt11', stderr: '' };
    }
    if (command === 'mints --help') {
      return { code: 0, stdout: 'Commands:\n  add\n  list\n  info', stderr: '' };
    }
    if (command === 'npc --help') {
      return { code: 0, stdout: 'Commands:\n  address\n  username', stderr: '' };
    }
    throw new Error('unexpected synchronous command');
  };
}

const ok = (stdout: string): CocodCommandResult => ({ code: 0, stdout, stderr: '' });

describe('live cocod process boundary', () => {
  it('pins one preflighted binary and requires explicit consent to use the current wallet', async () => {
    const syncCommands: string[][] = [];
    const processCalls: { bin: string; args: string[]; timeoutMs: number }[] = [];
    const runProcess: CocodProcessRunner = mock(async (bin, args, options) => {
      processCalls.push({ bin, args: [...args], timeoutMs: options.timeoutMs });
      return ok('UNLOCKED\n');
    });

    const live = await connectUnlockedCurrentCocod({
      currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
      env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
      syncExec: successfulSyncExec(syncCommands),
      which: () => null,
      runProcess,
      timeoutMs: 1_234,
    });

    expect(live.metadata).toEqual({
      bin: '/fixed/cocod',
      source: 'env',
      version: '0.0.16',
      home: '/Users/test/.cocod',
    });
    expect(live.capabilities).toContain('cocod.send.cashu');
    expect(live.capabilities).not.toContain('cocod.history');
    expect(syncCommands.every(([bin]) => bin === '/fixed/cocod')).toBe(true);
    expect(processCalls).toEqual([{ bin: '/fixed/cocod', args: ['status'], timeoutMs: 1_234 }]);

    await expect(
      connectUnlockedCurrentCocod({
        currentWalletAcknowledgement: 'missing-consent' as never,
        env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
        syncExec: successfulSyncExec([]),
        which: () => null,
        runProcess,
      })
    ).rejects.toThrow(/acknowledgement required/);
  });

  it('performs a synchronous preflight before exposing the typed counterparty', () => {
    const commands: string[][] = [];
    const boundary = preflightCurrentCocod({
      currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
      env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
      syncExec: successfulSyncExec(commands),
      which: () => null,
      runProcess: async () => ok('UNLOCKED'),
    });

    expect(commands.length).toBe(6);
    expect(boundary.cocod).toBeDefined();
    expect(boundary.execute).toBeFunction();
  });

  it('fails closed on an unexpected version or a wallet that is not unlocked', async () => {
    const badVersion: Exec = () => ({ code: 0, stdout: 'cocod 9.9.9', stderr: '' });
    expect(() =>
      preflightCurrentCocod({
        currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
        env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
        syncExec: badVersion,
        which: () => null,
        runProcess: async () => ok('UNLOCKED'),
      })
    ).toThrow('cocod preflight failed');

    await expect(
      connectUnlockedCurrentCocod({
        currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
        env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
        syncExec: successfulSyncExec([]),
        which: () => null,
        runProcess: async () => ok('LOCKED'),
      })
    ).rejects.toThrow('cocod current wallet is not unlocked');
  });

  it('never includes sensitive argv or process output in errors', async () => {
    const secret = 'cashuBsecret-token-material';
    const outputSecret = 'lnbc1output-secret-material';
    let processCalls = 0;
    const boundary = preflightCurrentCocod({
      currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
      env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
      syncExec: successfulSyncExec([]),
      which: () => null,
      runProcess: async () => {
        processCalls += 1;
        throw new Error(`process rejected ${secret} ${outputSecret}`);
      },
    });

    try {
      await boundary.execute(['receive', 'cashu', secret], {
        timeoutMs: 100,
        sensitiveArguments: [2],
      });
      throw new Error('expected process failure');
    } catch (error) {
      expect((error as Error).message).toBe('cocod process failed');
      expect((error as Error).message).not.toContain(secret);
      expect((error as Error).message).not.toContain(outputSecret);
    }
    expect(processCalls).toBe(1);
  });

  it('defensively refuses history without invoking the process runner', async () => {
    let processCalls = 0;
    const boundary = preflightCurrentCocod({
      currentWalletAcknowledgement: CURRENT_COCOD_WALLET_ACKNOWLEDGEMENT,
      env: { HOME: '/Users/test', COCOD_BIN: '/fixed/cocod' },
      syncExec: successfulSyncExec([]),
      which: () => null,
      runProcess: async () => {
        processCalls += 1;
        return ok('should not run');
      },
    });

    await expect(
      boundary.execute(['history'], { timeoutMs: 100, sensitiveArguments: [] })
    ).rejects.toThrow('cocod history is disabled');
    expect(processCalls).toBe(0);
  });
});
