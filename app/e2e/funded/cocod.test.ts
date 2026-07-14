import { describe, expect, it, mock } from 'bun:test';

import {
  createCocodCounterparty,
  type CocodCommandExecutor,
  type CocodCommandResult,
} from './cocod';
import type { DeclaredRecoveryAsset } from './types';

const asset: DeclaredRecoveryAsset = {
  mintUrl: 'https://mint.sovran.money',
  unit: 'sat',
  accountIndex: 0,
  maxPrincipal: 100,
};
const token = 'cashuBsecret-token-material';

const result = (stdout: string, code = 0): CocodCommandResult => ({
  code,
  stdout,
  stderr: '',
});

describe('typed cocod counterparty', () => {
  it('exposes strict status and exact mint/unit balance snapshots without history', async () => {
    const commands: string[][] = [];
    const execute: CocodCommandExecutor = mock(async (args) => {
      commands.push([...args]);
      if (args[0] === 'status') return result('UNLOCKED\n');
      if (args[0] === 'balance') {
        return result(
          JSON.stringify({
            'https://mint.sovran.money/': { sats: 60 },
            'https://other.mint': { sats: 900 },
          })
        );
      }
      throw new Error('unexpected command');
    });
    const cocod = createCocodCounterparty({ execute });

    expect(await cocod.status()).toBe('UNLOCKED');
    const snapshot = await cocod.balanceSnapshot();
    expect(cocod.exactBalance(snapshot, asset)).toBe(60);
    expect(commands).toEqual([['status'], ['balance']]);
    expect(commands.flat()).not.toContain('history');
  });

  it('creates a mint-pinned token and parses a typed Cashu receive result', async () => {
    const commands: string[][] = [];
    const execute: CocodCommandExecutor = mock(async (args) => {
      commands.push([...args]);
      if (args[0] === 'send') return result(`Created token\n${token}\n`);
      if (args[0] === 'receive') return result('Received 40\n');
      throw new Error('unexpected command');
    });
    const cocod = createCocodCounterparty({ execute });

    expect(await cocod.createCashu(asset, 40)).toEqual({ token, amount: 40 });
    expect(await cocod.receiveCashu(token)).toEqual({ reportedAmount: 40 });
    expect(commands).toEqual([
      ['send', 'cashu', '40', '--mint-url', asset.mintUrl],
      ['receive', 'cashu', token],
    ]);
  });

  it('creates and pays mint-pinned BOLT11 invoices and reads a strict NPC address', async () => {
    const invoice = `lnbc1${'q'.repeat(80)}`;
    const invocations: { args: string[]; sensitive: readonly number[] }[] = [];
    const execute: CocodCommandExecutor = mock(async (args, options) => {
      invocations.push({ args: [...args], sensitive: options.sensitiveArguments });
      if (args[0] === 'receive') return result(invoice);
      if (args[0] === 'send') return result(`Paid invoice: ${invoice}`);
      if (args[0] === 'npc') return result('cocod@npubx.cash');
      throw new Error('unexpected command');
    });
    const cocod = createCocodCounterparty({ execute });

    expect(await cocod.createBolt11(asset, 21)).toEqual({ invoice, amount: 21 });
    expect(await cocod.payBolt11(asset, invoice, 21)).toEqual({ paid: true, amount: 21 });
    expect(await cocod.npcAddress()).toBe('cocod@npubx.cash');
    expect(invocations).toEqual([
      {
        args: ['receive', 'bolt11', '21', '--mint-url', asset.mintUrl],
        sensitive: [],
      },
      {
        args: ['send', 'bolt11', invoice, '--mint-url', asset.mintUrl],
        sensitive: [2],
      },
      { args: ['npc', 'address'], sensitive: [] },
    ]);
  });

  it('fails closed on unknown status, unsupported units, malformed balance, and secret-bearing errors', async () => {
    const unknown = createCocodCounterparty({ execute: async () => result('MAYBE') });
    expect(unknown.status()).rejects.toThrow(/unknown cocod status/);

    const usdAsset = { ...asset, unit: 'usd' };
    const satOnly = createCocodCounterparty({ execute: async () => result('{}') });
    expect(satOnly.createCashu(usdAsset, 1)).rejects.toThrow(/unsupported unit/);

    const malformed = createCocodCounterparty({ execute: async () => result('{"mint":null}') });
    expect(malformed.balanceSnapshot()).rejects.toThrow(/invalid cocod balance/);

    const failing = createCocodCounterparty({
      execute: async () => {
        throw new Error(`failed while handling ${token}`);
      },
    });
    try {
      await failing.receiveCashu(token);
      throw new Error('expected receive failure');
    } catch (error) {
      expect((error as Error).message).toContain('cocod receive cashu failed');
      expect((error as Error).message).not.toContain(token);
    }
  });
});
