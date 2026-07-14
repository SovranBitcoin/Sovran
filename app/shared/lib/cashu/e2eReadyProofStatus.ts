import { normalizeMintUrl } from '@cashu/coco-core';

export const E2E_READY_PROOF_STATUS_ID = 'e2e-ready-proof-reconciliation' as const;

export interface E2EReadyProofRemainingAsset {
  mintUrl: string;
  unit: string;
  amount: number;
}

export interface E2EReadyProofStatus {
  version: 1;
  phase: 'idle' | 'running' | 'complete' | 'failed';
  assets: number;
  checked: number;
  spent: number;
  remaining: E2EReadyProofRemainingAsset[];
}

const EMPTY_STATUS: E2EReadyProofStatus = Object.freeze({
  version: 1,
  phase: 'idle',
  assets: 0,
  checked: 0,
  spent: 0,
  remaining: [],
});

let current: E2EReadyProofStatus = EMPTY_STATUS;
const listeners = new Set<() => void>();

function safeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validatedStatus(value: unknown): E2EReadyProofStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('E2E ready-proof status must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'assets,checked,phase,remaining,spent,version' ||
    record.version !== 1 ||
    !['idle', 'running', 'complete', 'failed'].includes(String(record.phase)) ||
    !safeCount(record.assets) ||
    !safeCount(record.checked) ||
    !safeCount(record.spent) ||
    !Array.isArray(record.remaining)
  ) {
    throw new Error('E2E ready-proof status has an invalid shape');
  }
  const seen = new Set<string>();
  const remaining = record.remaining.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('E2E ready-proof remaining asset must be an object');
    }
    const asset = item as Record<string, unknown>;
    if (
      Object.keys(asset).sort().join(',') !== 'amount,mintUrl,unit' ||
      typeof asset.mintUrl !== 'string' ||
      typeof asset.unit !== 'string' ||
      !safeCount(asset.amount)
    ) {
      throw new Error('E2E ready-proof remaining asset has an invalid shape');
    }
    const mintUrl = normalizeMintUrl(asset.mintUrl);
    const unit = asset.unit.trim().toLowerCase();
    const id = `${mintUrl}\u0000${unit}`;
    if (!unit || seen.has(id)) {
      throw new Error('E2E ready-proof remaining assets are invalid');
    }
    seen.add(id);
    return { mintUrl, unit, amount: asset.amount as number };
  });
  return {
    version: 1,
    phase: record.phase as E2EReadyProofStatus['phase'],
    assets: record.assets,
    checked: record.checked,
    spent: record.spent,
    remaining,
  };
}

export function publishE2EReadyProofStatus(status: E2EReadyProofStatus): void {
  current = validatedStatus(status);
  for (const listener of listeners) listener();
}

export function getE2EReadyProofStatus(): E2EReadyProofStatus {
  return current;
}

export function subscribeE2EReadyProofStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function serializeE2EReadyProofStatus(status: E2EReadyProofStatus): string {
  return JSON.stringify(validatedStatus(status));
}

export function parseE2EReadyProofStatus(raw: string): E2EReadyProofStatus {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('E2E ready-proof status is malformed');
  }
  return validatedStatus(value);
}
