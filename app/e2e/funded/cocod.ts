import { normalizeMintUrl } from './mint-url';
import type { DeclaredRecoveryAsset } from './types';

type CocodStatus = 'UNINITIALIZED' | 'LOCKED' | 'UNLOCKED' | 'ERROR';

export interface CocodCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CocodCommandExecutor = (
  args: readonly string[],
  options: { timeoutMs: number; sensitiveArguments: readonly number[] }
) => Promise<CocodCommandResult>;

export type CocodBalanceSnapshot = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface CocodCounterparty {
  status(): Promise<CocodStatus>;
  balanceSnapshot(): Promise<CocodBalanceSnapshot>;
  exactBalance(snapshot: CocodBalanceSnapshot, asset: DeclaredRecoveryAsset): number;
  createCashu(
    asset: DeclaredRecoveryAsset,
    amount: number
  ): Promise<{ token: string; amount: number }>;
  receiveCashu(token: string): Promise<{ reportedAmount: number }>;
  createBolt11(
    asset: DeclaredRecoveryAsset,
    amount: number
  ): Promise<{ invoice: string; amount: number }>;
  payBolt11(
    asset: DeclaredRecoveryAsset,
    invoice: string,
    amount: number
  ): Promise<{ paid: true; amount: number }>;
  npcAddress(): Promise<string>;
}

const STATUSES = new Set<CocodStatus>(['UNINITIALIZED', 'LOCKED', 'UNLOCKED', 'ERROR']);
const CASHU_TOKEN = /\bcashu[AB][A-Za-z0-9_-]+\b/g;
const BOLT11 = /\bln(?:bc|tb|bcrt)[a-z0-9]+\b/gi;

function assertAmount(asset: DeclaredRecoveryAsset, amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > asset.maxPrincipal) {
    throw new Error('invalid cocod payment amount');
  }
}

function assertAsset(asset: DeclaredRecoveryAsset, supportedUnits: ReadonlySet<string>): void {
  if (asset.accountIndex !== 0) throw new Error('cocod recovery supports only account 0');
  if (!supportedUnits.has(asset.unit)) {
    throw new Error(`unsupported unit for cocod recovery: ${asset.unit}`);
  }
}

function parseBalance(stdout: string): CocodBalanceSnapshot {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error('invalid cocod balance response');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid cocod balance response');
  }

  const snapshot: Record<string, Record<string, number>> = {};
  for (const [mintInput, unitsInput] of Object.entries(value)) {
    if (!unitsInput || typeof unitsInput !== 'object' || Array.isArray(unitsInput)) {
      throw new Error('invalid cocod balance response');
    }
    let mintUrl: string;
    try {
      mintUrl = normalizeMintUrl(mintInput);
    } catch {
      throw new Error('invalid cocod balance response');
    }
    if (snapshot[mintUrl]) throw new Error('duplicate mint in cocod balance response');
    const units: Record<string, number> = {};
    for (const [unitInput, amount] of Object.entries(unitsInput)) {
      const unit = unitInput === 'sats' ? 'sat' : unitInput;
      if (
        units[unit] !== undefined ||
        typeof amount !== 'number' ||
        !Number.isSafeInteger(amount) ||
        amount < 0
      ) {
        throw new Error('invalid cocod balance response');
      }
      units[unit] = amount;
    }
    snapshot[mintUrl] = Object.freeze(units);
  }
  return Object.freeze(snapshot);
}

export function createCocodCounterparty(options: {
  execute: CocodCommandExecutor;
  supportedUnits?: readonly string[];
  timeoutMs?: number;
}): CocodCounterparty {
  const supportedUnits = new Set(options.supportedUnits ?? ['sat']);
  const timeoutMs = options.timeoutMs ?? 60_000;

  const run = async (
    operation: string,
    args: readonly string[],
    sensitiveArguments: readonly number[] = []
  ): Promise<string> => {
    let result: CocodCommandResult;
    try {
      result = await options.execute(args, { timeoutMs, sensitiveArguments });
    } catch {
      throw new Error(`cocod ${operation} failed`);
    }
    if (
      !Number.isSafeInteger(result.code) ||
      result.code !== 0 ||
      typeof result.stdout !== 'string'
    ) {
      throw new Error(`cocod ${operation} failed`);
    }
    return result.stdout.trim();
  };

  return {
    async status() {
      const raw = await run('status', ['status']);
      if (!STATUSES.has(raw as CocodStatus)) throw new Error('unknown cocod status response');
      return raw as CocodStatus;
    },

    async balanceSnapshot() {
      return parseBalance(await run('balance', ['balance']));
    },

    exactBalance(snapshot, asset) {
      assertAsset(asset, supportedUnits);
      const mintUrl = normalizeMintUrl(asset.mintUrl);
      return snapshot[mintUrl]?.[asset.unit] ?? 0;
    },

    async createCashu(asset, amount) {
      assertAsset(asset, supportedUnits);
      assertAmount(asset, amount);
      const stdout = await run('send cashu', [
        'send',
        'cashu',
        String(amount),
        '--mint-url',
        asset.mintUrl,
      ]);
      const matches = [...stdout.matchAll(CASHU_TOKEN)].map((match) => match[0]);
      const unique = [...new Set(matches)];
      if (unique.length !== 1) throw new Error('cocod send cashu returned no unique token');
      return { token: unique[0], amount };
    },

    async receiveCashu(token) {
      if (!/^cashu[AB][A-Za-z0-9_-]+$/.test(token)) {
        throw new Error('invalid Cashu token supplied to cocod receive');
      }
      const stdout = await run('receive cashu', ['receive', 'cashu', token], [2]);
      const match = stdout.match(/(?:^|\n)Received (\d+)$/);
      if (!match) throw new Error('cocod receive cashu returned an invalid result');
      const reportedAmount = Number(match[1]);
      if (!Number.isSafeInteger(reportedAmount) || reportedAmount <= 0) {
        throw new Error('cocod receive cashu returned an invalid amount');
      }
      return { reportedAmount };
    },

    async createBolt11(asset, amount) {
      assertAsset(asset, supportedUnits);
      assertAmount(asset, amount);
      const stdout = await run('receive bolt11', [
        'receive',
        'bolt11',
        String(amount),
        '--mint-url',
        asset.mintUrl,
      ]);
      const invoices = [...stdout.matchAll(BOLT11)].map((match) => match[0].toLowerCase());
      const unique = [...new Set(invoices)];
      if (unique.length !== 1) throw new Error('cocod receive bolt11 returned no unique invoice');
      return { invoice: unique[0], amount };
    },

    async payBolt11(asset, invoice, amount) {
      assertAsset(asset, supportedUnits);
      assertAmount(asset, amount);
      if (!new RegExp(`^(?:${BOLT11.source})$`, 'i').test(invoice)) {
        throw new Error('invalid BOLT11 invoice supplied to cocod');
      }
      await run('send bolt11', ['send', 'bolt11', invoice, '--mint-url', asset.mintUrl], [2]);
      return { paid: true, amount };
    },

    async npcAddress() {
      const stdout = await run('npc address', ['npc', 'address']);
      const lines = stdout.split(/\r?\n/).filter(Boolean);
      const address = lines.at(-1);
      if (!address || !/^[a-z0-9._-]+@npubx\.cash$/i.test(address)) {
        throw new Error('cocod returned an invalid NPC address');
      }
      return address;
    },
  };
}
