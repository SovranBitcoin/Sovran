export type MintAuditorId = 'nip87' | 'mintradar' | 'cashu-audit' | 'imf-gg';

interface MintAuditorDescriptor {
  id: MintAuditorId;
  name: string;
  description: string;
  transport: 'nostr' | 'http';
  defaultEnabled: boolean;
  endpoint?: string;
}

export const MINT_AUDITORS: readonly MintAuditorDescriptor[] = [
  {
    id: 'nip87',
    name: 'Nostr NIP-87',
    description: 'Decentralized mint announcements and reviews from Nostr relays.',
    transport: 'nostr',
    defaultEnabled: true,
  },
  {
    id: 'mintradar',
    name: 'MintRadar',
    description: 'Public HTTP monitor (mintradar.org) with 5-minute uptime and swap probes.',
    transport: 'http',
    defaultEnabled: true,
    endpoint: 'https://mintradar.org/api/v1/wallets/mints',
  },
  {
    id: 'cashu-audit',
    name: 'Cashu Auditor',
    description: 'Public HTTP auditor (api.audit.8333.space) tracking swap history.',
    transport: 'http',
    defaultEnabled: true,
    endpoint: 'https://api.audit.8333.space/mints/',
  },
  {
    id: 'imf-gg',
    name: 'IMF.gg',
    description: 'Public HTTP mint review directory (imf.gg).',
    transport: 'http',
    defaultEnabled: true,
    endpoint: 'https://imf.gg/api/mints',
  },
] as const;

export const HTTP_MINT_AUDITOR_IDS: readonly MintAuditorId[] = MINT_AUDITORS.filter(
  (a) => a.transport === 'http'
).map((a) => a.id);

export function resolveEnabledAuditors(disabledIds: readonly string[]): MintAuditorId[] {
  const disabled = new Set(disabledIds);
  return MINT_AUDITORS.filter((auditor) => !disabled.has(auditor.id)).map((a) => a.id);
}

export type MintAuditStatus = 'online' | 'offline' | 'degraded' | 'archived';

export type MintAuditWarningCode =
  | 'offline'
  | 'archived'
  | 'lowUptime'
  | 'lowSuccessRate'
  | 'mintDisabled'
  | 'meltDisabled'
  | 'outdated'
  | 'testMint';

export interface MintAuditWarning {
  code: MintAuditWarningCode;
  params?: Record<string, string | number>;
}

export interface MintAuditSummary {
  mintUrl: string;
  status: MintAuditStatus;
  score?: number;
  uptime24h?: number;
  uptime7d?: number;
  uptime30d?: number;
  latencyMs?: number;
  swaps?: { okCount: number; totalCount: number };
  warnings: MintAuditWarning[];
  sources: MintAuditorId[];
  auditUrl?: string;
}

export const AUDIT_THRESHOLDS = {
  uptimePercent: 95,
  successRatePercent: 85,
  minSwaps: 10,
} as const;
