import { normalizeMintUrl } from '@cashu/coco-core';

export const E2E_READY_PROOF_RECONCILIATION_ENV = 'EXPO_PUBLIC_E2E_FUNDED_ASSETS' as const;

export interface E2EReadyProofAsset {
  mintUrl: string;
  unit: string;
}

function normalizeAsset(value: unknown): E2EReadyProofAsset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('E2E ready-proof asset must be an object');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'mintUrl,unit') {
    throw new Error('E2E ready-proof asset has an invalid shape');
  }
  if (typeof record.mintUrl !== 'string' || typeof record.unit !== 'string') {
    throw new Error('E2E ready-proof asset fields must be strings');
  }
  let mintUrl: string;
  try {
    mintUrl = normalizeMintUrl(record.mintUrl);
    const url = new URL(mintUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('unsafe mint URL');
    }
  } catch {
    throw new Error('E2E ready-proof asset requires a safe HTTPS mint URL');
  }
  const unit = record.unit.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,15}$/.test(unit)) {
    throw new Error('E2E ready-proof asset has an invalid unit');
  }
  return { mintUrl, unit };
}

function normalizeAssets(input: readonly unknown[]): E2EReadyProofAsset[] {
  if (input.length === 0 || input.length > 16) {
    throw new Error('E2E ready-proof reconciliation requires 1-16 assets');
  }
  const assets = input.map(normalizeAsset);
  const seen = new Set<string>();
  for (const asset of assets) {
    const id = `${asset.mintUrl}\u0000${asset.unit}`;
    if (seen.has(id)) throw new Error('E2E ready-proof assets contain a duplicate');
    seen.add(id);
  }
  return assets.sort((left, right) =>
    `${left.mintUrl}\u0000${left.unit}`.localeCompare(`${right.mintUrl}\u0000${right.unit}`)
  );
}

export function serializeE2EReadyProofAssets(input: readonly E2EReadyProofAsset[]): string {
  return JSON.stringify({ version: 1, assets: normalizeAssets(input) });
}

export function parseE2EReadyProofAssets(raw: string): E2EReadyProofAsset[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('E2E ready-proof reconciliation config is malformed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('E2E ready-proof reconciliation config must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',') !== 'assets,version' ||
    record.version !== 1 ||
    !Array.isArray(record.assets)
  ) {
    throw new Error('E2E ready-proof reconciliation config has an invalid shape');
  }
  return normalizeAssets(record.assets);
}
