export type MintAuditorId =
  'nip87' | 'mintradar' | 'cashu-audit' | 'imf-gg' | 'ucash' | 'macadamia';

/** The CDK auditors (cashubtc/cdk `cdk-auditor`, Leptos server functions). */
export type CdkAuditorId = Extract<MintAuditorId, 'ucash' | 'macadamia'>;

interface MintAuditorDescriptor {
  id: MintAuditorId;
  name: string;
  description: string;
  transport: 'nostr' | 'http';
  /** Off-by-default auditors run only once the person switches them on. */
  defaultEnabled: boolean;
  endpoint?: string;
  /**
   * CDK auditors expose Leptos server functions whose route carries a build
   * hash (`/api/search_mints<suffix>`); the suffix is part of the address.
   */
  functionSuffix?: string;
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
  {
    id: 'ucash',
    name: 'uCash Auditor',
    description: 'Public CDK auditor (auditor.ucash.space) that test-pays mints and tracks uptime.',
    transport: 'http',
    defaultEnabled: true,
    endpoint: 'https://auditor.ucash.space',
    functionSuffix: '5929181479826419594',
  },
  {
    id: 'macadamia',
    name: 'Macadamia Auditor',
    description:
      'Public CDK auditor run by Macadamia. Its address says regtest, but it tracks real mainnet mints. Off unless you turn it on.',
    transport: 'http',
    defaultEnabled: false,
    endpoint: 'https://auditor.regtest.macadamia.cash',
    functionSuffix: '5929181479826419594',
  },
] as const;

export function auditorDescriptor(id: MintAuditorId): MintAuditorDescriptor | undefined {
  return MINT_AUDITORS.find((auditor) => auditor.id === id);
}

export const HTTP_MINT_AUDITOR_IDS: readonly MintAuditorId[] = MINT_AUDITORS.filter(
  (a) => a.transport === 'http'
).map((a) => a.id);

/**
 * Which auditors run. A default-on auditor runs unless its id is in
 * `disabledIds` (the saved denylist, unchanged since it shipped); a
 * default-off auditor runs only when its id is in `enabledIds`, so an install
 * that never saw the toggle keeps it off.
 */
export function resolveEnabledAuditors(
  disabledIds: readonly string[],
  enabledIds: readonly string[] = []
): MintAuditorId[] {
  const disabled = new Set(disabledIds);
  const enabled = new Set(enabledIds);
  return MINT_AUDITORS.filter((auditor) =>
    auditor.defaultEnabled ? !disabled.has(auditor.id) : enabled.has(auditor.id)
  ).map((a) => a.id);
}

/** Whether one auditor runs, by the same rule. */
export function isAuditorEnabled(
  id: MintAuditorId,
  disabledIds: readonly string[],
  enabledIds: readonly string[] = []
): boolean {
  return resolveEnabledAuditors(disabledIds, enabledIds).includes(id);
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
