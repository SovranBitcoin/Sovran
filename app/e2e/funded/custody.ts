import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';
import type { CounterSource } from '@cashu/cashu-ts';

import {
  acquireDurableLease,
  durableReplaceFile,
  durableUnlinkFile,
  ensurePrivateDirectory,
} from '../ledger/durable';
import { deriveSovranAccount0CashuSeed } from './derivation';
import { controlledP2PKPublicKey } from './p2pk';
import {
  DEFAULT_RESTORE_POLICY,
  type DeclaredAssetTransfer,
  type DeclaredRecoveryAsset,
  type RestorePolicy,
  type AssetReconciliation,
} from './types';

const assetSchema = z.strictObject({
  mintUrl: z.string().url(),
  unit: z.string().min(1).max(16),
  accountIndex: z.literal(0),
  maxPrincipal: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const transferSchema = z.strictObject({
  fromMintUrl: z.string().url(),
  toMintUrl: z.string().url(),
  unit: z.string().min(1).max(16),
  accountIndex: z.literal(0),
  maxFeeSats: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

const restorePolicySchema = z.strictObject({
  gapLimit: z.number().int().positive().max(10_000),
  batchSize: z.number().int().positive().max(10_000),
});

const counterSchema = z.strictObject({
  asset: assetSchema,
  keysetId: z.string().min(1).max(256),
  next: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

const redemptionSchema = z.strictObject({
  id: z.string().min(1).max(128),
  asset: assetSchema,
  phase: z.enum(['prepared', 'received', 'reconciled']),
  token: z.string().min(1).optional(),
  tokenFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  restoredAmount: z.number().int().nonnegative(),
  tokenAmount: z.number().int().nonnegative(),
  sendFee: z.number().int().nonnegative(),
  beforeBalance: z.number().int().nonnegative(),
  reportedAmount: z.number().int().nonnegative().optional(),
  afterBalance: z.number().int().nonnegative().optional(),
  counterpartyDelta: z.number().int().nonnegative().optional(),
  receiveFee: z.number().int().nonnegative().optional(),
});

const counterpartyTokenSchema = z.strictObject({
  id: z.string().min(1).max(128),
  asset: assetSchema,
  phase: z.enum(['prepared', 'returning', 'returned', 'spent', 'reconciled']),
  token: z.string().min(1).optional(),
  tokenFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  amount: z.number().int().positive(),
  beforeBalance: z.number().int().nonnegative(),
  afterCreateBalance: z.number().int().nonnegative().optional(),
  debitedAmount: z.number().int().nonnegative().optional(),
  creationFee: z.number().int().nonnegative().optional(),
  returnBeforeBalance: z.number().int().nonnegative().optional(),
  returnAfterBalance: z.number().int().nonnegative().optional(),
  reportedAmount: z.number().int().nonnegative().optional(),
  counterpartyDelta: z.number().int().nonnegative().optional(),
  returnFee: z.number().int().nonnegative().optional(),
  disposition: z.enum(['returned', 'spent-by-app']).optional(),
});

const assetReconciliationSchema = z.strictObject({
  asset: assetSchema,
  restoredAmount: z.number().int().nonnegative(),
  tokenAmount: z.number().int().nonnegative(),
  counterpartyDelta: z.number().int().nonnegative(),
  sendFee: z.number().int().nonnegative(),
  receiveFee: z.number().int().nonnegative(),
  residualAmount: z.literal(0),
});

const custodyRecordSchema = z.strictObject({
  version: z.literal(1),
  appMnemonic: z.string().min(1),
  p2pkPrivateKey: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  assets: z.array(assetSchema).min(1),
  transfers: z.array(transferSchema).optional(),
  restore: restorePolicySchema,
  counters: z.array(counterSchema),
  redemptions: z.array(redemptionSchema),
  counterpartyTokens: z.array(counterpartyTokenSchema),
  assetReconciliations: z.array(assetReconciliationSchema),
});

export type CustodyRecord = z.infer<typeof custodyRecordSchema>;
export type CustodyRedemption = z.infer<typeof redemptionSchema>;
export type CustodyCounterpartyToken = z.infer<typeof counterpartyTokenSchema>;

export const assetIdentity = (asset: DeclaredRecoveryAsset): string =>
  `${asset.mintUrl}\u0000${asset.unit}\u0000${asset.accountIndex}`;

function assertAssets(input: readonly DeclaredRecoveryAsset[]): DeclaredRecoveryAsset[] {
  if (input.some((asset) => asset.accountIndex !== 0)) {
    throw new Error('funded recovery supports only Sovran account 0');
  }
  const result = z.array(assetSchema).min(1).safeParse(input);
  if (!result.success) throw new Error('invalid funded recovery asset declaration');
  const parsed = result.data;
  const seen = new Set<string>();
  for (const asset of parsed) {
    const id = assetIdentity(asset);
    if (seen.has(id))
      throw new Error(`duplicate asset declaration: ${asset.mintUrl} ${asset.unit}`);
    seen.add(id);
  }
  return parsed;
}

function assertTransfers(
  transfers: readonly DeclaredAssetTransfer[],
  assets: readonly DeclaredRecoveryAsset[]
): DeclaredAssetTransfer[] {
  const result = z.array(transferSchema).safeParse(transfers);
  if (!result.success) throw new Error('invalid funded transfer declaration');
  for (const transfer of result.data) {
    const declared = (mintUrl: string) =>
      assets.some(
        (asset) =>
          asset.mintUrl === mintUrl &&
          asset.unit === transfer.unit &&
          asset.accountIndex === transfer.accountIndex
      );
    if (
      transfer.fromMintUrl === transfer.toMintUrl ||
      !declared(transfer.fromMintUrl) ||
      !declared(transfer.toMintUrl)
    ) {
      throw new Error('funded transfer must connect two distinct declared assets');
    }
  }
  return result.data;
}

function assertPrivateRegularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('recovery custody is not a regular file');
  }
  if ((stat.mode & 0o077) !== 0 || (stat.mode & 0o600) !== 0o600) {
    throw new Error('recovery custody permissions are unsafe');
  }
}

function readRecord(path: string): CustodyRecord {
  assertPrivateRegularFile(path);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('recovery custody is unreadable');
  }
  const parsed = custodyRecordSchema.safeParse(raw);
  if (!parsed.success) throw new Error('recovery custody failed validation');
  // Validate the secret independently so a malformed mnemonic can never be
  // treated as usable custody merely because its JSON shape is valid.
  deriveSovranAccount0CashuSeed(parsed.data.appMnemonic);
  if (parsed.data.p2pkPrivateKey) controlledP2PKPublicKey(parsed.data.p2pkPrivateKey);
  assertAssets(parsed.data.assets);
  if (parsed.data.transfers) assertTransfers(parsed.data.transfers, parsed.data.assets);
  return parsed.data;
}

export class RecoveryCustody {
  readonly path: string;
  readonly #locksDir: string;

  private constructor(path: string, locksDir: string) {
    this.path = path;
    this.#locksDir = locksDir;
  }

  static establish(options: {
    runDir: string;
    appMnemonic: string;
    assets: readonly DeclaredRecoveryAsset[];
    transfers?: readonly DeclaredAssetTransfer[];
    restore?: RestorePolicy;
    p2pkPrivateKey?: string;
  }): RecoveryCustody {
    // Derive before creating any file so invalid secret material leaves no
    // custody-shaped artifact behind.
    deriveSovranAccount0CashuSeed(options.appMnemonic);
    if (options.p2pkPrivateKey) controlledP2PKPublicKey(options.p2pkPrivateKey);
    const assets = assertAssets(options.assets);
    const transfers = options.transfers?.length
      ? assertTransfers(options.transfers, assets)
      : undefined;
    const restore = restorePolicySchema.parse(options.restore ?? DEFAULT_RESTORE_POLICY);
    const dir = join(options.runDir, 'funded-custody');
    const locksDir = join(dir, 'locks');
    const path = join(dir, 'recovery.json');
    ensurePrivateDirectory(dir);
    ensurePrivateDirectory(locksDir);
    const lease = acquireDurableLease(join(locksDir, 'create.lock'), 'create recovery custody');
    try {
      if (existsSync(path)) throw new Error('recovery custody already exists');
      const record: CustodyRecord = {
        version: 1,
        appMnemonic: options.appMnemonic.trim().toLowerCase().split(/\s+/).join(' '),
        ...(options.p2pkPrivateKey ? { p2pkPrivateKey: options.p2pkPrivateKey } : {}),
        assets,
        ...(transfers ? { transfers } : {}),
        restore,
        counters: [],
        redemptions: [],
        counterpartyTokens: [],
        assetReconciliations: [],
      };
      durableReplaceFile(path, JSON.stringify(record), 0o600);
    } finally {
      lease.release();
    }
    return new RecoveryCustody(path, locksDir);
  }

  static open(runDir: string): RecoveryCustody {
    const dir = join(runDir, 'funded-custody');
    const locksDir = join(dir, 'locks');
    const path = join(dir, 'recovery.json');
    readRecord(path);
    return new RecoveryCustody(path, locksDir);
  }

  snapshot(): CustodyRecord {
    return structuredClone(readRecord(this.path));
  }

  update(mutator: (record: CustodyRecord) => void): CustodyRecord {
    const leasePath = join(
      this.#locksDir,
      `${createHash('sha256').update(this.path).digest('hex')}.update.lock`
    );
    const lease = acquireDurableLease(leasePath, 'update recovery custody');
    try {
      const record = readRecord(this.path);
      mutator(record);
      const parsed = custodyRecordSchema.safeParse(record);
      if (!parsed.success) throw new Error('refusing to persist invalid recovery custody');
      durableReplaceFile(this.path, JSON.stringify(parsed.data), 0o600);
      return structuredClone(parsed.data);
    } finally {
      lease.release();
    }
  }

  async runExclusive<T>(operation: string, task: () => Promise<T>): Promise<T> {
    const lease = acquireDurableLease(join(this.#locksDir, 'effects.lock'), operation);
    try {
      return await task();
    } finally {
      lease.release();
    }
  }

  counterSource(asset: DeclaredRecoveryAsset): CounterSource {
    const id = assetIdentity(asset);
    const assertDeclared = (record: CustodyRecord): void => {
      if (!record.assets.some((candidate) => assetIdentity(candidate) === id)) {
        throw new Error('counter source requested for undeclared recovery asset');
      }
    };
    return {
      reserve: async (keysetId, count) => {
        if (!Number.isSafeInteger(count) || count < 0) {
          throw new Error('invalid deterministic counter reservation');
        }
        if (count === 0) {
          const record = this.snapshot();
          assertDeclared(record);
          const current = record.counters.find(
            (entry) => assetIdentity(entry.asset) === id && entry.keysetId === keysetId
          );
          return { start: current?.next ?? 0, count: 0 };
        }
        let start = 0;
        this.update((record) => {
          assertDeclared(record);
          const current = record.counters.find(
            (entry) => assetIdentity(entry.asset) === id && entry.keysetId === keysetId
          );
          start = current?.next ?? 0;
          const next = start + count;
          if (!Number.isSafeInteger(next)) throw new Error('deterministic counter overflow');
          if (current) current.next = next;
          else record.counters.push({ asset, keysetId, next });
        });
        return { start, count };
      },
      advanceToAtLeast: async (keysetId, minNext) => {
        if (!Number.isSafeInteger(minNext) || minNext < 0) {
          throw new Error('invalid deterministic counter high-water');
        }
        this.update((record) => {
          assertDeclared(record);
          const current = record.counters.find(
            (entry) => assetIdentity(entry.asset) === id && entry.keysetId === keysetId
          );
          if (current) current.next = Math.max(current.next, minNext);
          else record.counters.push({ asset, keysetId, next: minNext });
        });
      },
      snapshot: async () => {
        const record = this.snapshot();
        assertDeclared(record);
        return Object.fromEntries(
          record.counters
            .filter((entry) => assetIdentity(entry.asset) === id)
            .map((entry) => [entry.keysetId, entry.next])
        );
      },
    };
  }

  markAssetReconciled(reconciliation: AssetReconciliation): void {
    const id = assetIdentity(reconciliation.asset);
    this.update((record) => {
      const index = record.assetReconciliations.findIndex(
        (candidate) => assetIdentity(candidate.asset) === id
      );
      if (index === -1) record.assetReconciliations.push(reconciliation);
      else record.assetReconciliations[index] = reconciliation;
    });
  }

  disposePrivateMaterial(): void {
    const lease = acquireDurableLease(
      join(this.#locksDir, 'effects.lock'),
      'dispose recovery custody'
    );
    try {
      const record = readRecord(this.path);
      const reconciled = new Set(
        record.assetReconciliations.map(({ asset }) => assetIdentity(asset))
      );
      if (record.assets.some((asset) => !reconciled.has(assetIdentity(asset)))) {
        throw new Error('cannot dispose recovery custody before every asset is reconciled');
      }
      if (record.redemptions.some(({ phase }) => phase !== 'reconciled')) {
        throw new Error('cannot dispose recovery custody with an open redemption');
      }
      if (record.counterpartyTokens.some(({ phase }) => phase !== 'reconciled')) {
        throw new Error('cannot dispose recovery custody with an open counterparty token');
      }
      durableUnlinkFile(this.path);
    } finally {
      lease.release();
    }
  }
}
