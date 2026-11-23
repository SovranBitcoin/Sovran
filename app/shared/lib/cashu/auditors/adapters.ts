import { z } from 'zod';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import {
  AUDIT_THRESHOLDS,
  type MintAuditorId,
  type MintAuditStatus,
  type MintAuditSummary,
  type MintAuditWarning,
} from './registry';

const AUDITOR_TIMEOUT_MS = 8_000;

export const MINTRADAR_LIST_URL = 'https://mintradar.org/api/v1/wallets/mints';
export const MINTRADAR_SITE_URL = 'https://mintradar.org/mint';
export const CASHU_AUDIT_LIST_URL = 'https://api.audit.8333.space/mints/';
export const IMF_LIST_URL = 'https://imf.gg/api/mints?page=1';

export interface AuditorMintEntry {
  source: MintAuditorId;
  mintUrl: string;
  name?: string;
  description?: string;
  iconUrl?: string;
  supportedUnits?: string[];
  nuts?: Record<string, unknown>;
  operatorPubkey?: string;
  state?: string;
  status?: 'online' | 'offline' | 'unknown';
  testnut?: boolean;
  nMints?: number;
  nMelts?: number;
  nErrors?: number;
  reviewCount?: number;
  averageScore?: number;
  auditScore?: number;
  uptime30d?: number;
  warnings?: MintAuditWarning[];
}

export interface AuditorFetchControls {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function fetchAuditorJson(
  url: string,
  source: MintAuditorId,
  controls: AuditorFetchControls = {}
): Promise<unknown | null> {
  try {
    // eslint-disable-next-line no-restricted-globals -- public third-party auditor endpoints
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: buildAbortSignal({ timeoutMs: controls.timeoutMs ?? AUDITOR_TIMEOUT_MS, ...controls }),
    });
    if (!response.ok) {
      apiLog.debug('cashu.auditor.http_error', { source, status: response.status });
      return null;
    }
    return await response.json();
  } catch (error) {
    apiLog.debug('cashu.auditor.fetch_failed', {
      source,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

const Nut06InfoSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
  icon_url: z.string().optional(),
  nuts: z.record(z.string(), z.unknown()).optional(),
  contact: z
    .array(z.looseObject({ method: z.string().optional(), info: z.string().optional() }))
    .optional(),
});

function cleanQuoted(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/^"+|"+$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractUnitsFromNuts(nuts?: Record<string, unknown>): string[] {
  if (!nuts) return [];
  const units = new Set<string>();
  for (const key of ['4', '5']) {
    const block = nuts[key];
    if (!block || typeof block !== 'object') continue;
    const methods = (block as { methods?: unknown }).methods;
    if (!Array.isArray(methods)) continue;
    for (const entry of methods) {
      if (entry && typeof entry === 'object' && typeof (entry as { unit?: unknown }).unit === 'string') {
        const u = ((entry as { unit: string }).unit).trim().toLowerCase();
        if (u) units.add(u);
      }
    }
  }
  return [...units];
}

export function parseNut06InfoJson(raw?: string | null): {
  name?: string;
  description?: string;
  iconUrl?: string;
  nuts?: Record<string, unknown>;
  supportedUnits?: string[];
  operatorPubkey?: string;
} {
  if (!raw) return {};
  try {
    const parsed = Nut06InfoSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    const info = parsed.data;
    const nostrContact = info.contact?.find(
      (c) => c.method?.toLowerCase() === 'nostr' && typeof c.info === 'string' && c.info.length > 0
    );
    const units = extractUnitsFromNuts(info.nuts);
    return {
      name: cleanQuoted(info.name),
      description: cleanQuoted(info.description),
      iconUrl: cleanQuoted(info.icon_url),
      nuts: info.nuts,
      supportedUnits: units.length > 0 ? units : undefined,
      operatorPubkey: nostrContact?.info,
    };
  } catch {
    return {};
  }
}

function isValidMintUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 1. MintRadar (https://mintradar.org/api/v1/wallets/mints)
// ---------------------------------------------------------------------------

const MintRadarMintSchema = z.looseObject({
  url: z.string(),
  name: z.string().nullish(),
  description: z.string().nullish(),
  iconUrl: z.string().nullish(),
  icon_url: z.string().nullish(),
  status: z.string().nullish(),
  score: z.number().nullish(),
  uptime24hPct: z.number().nullish(),
  uptime7dPct: z.number().nullish(),
  uptime30dPct: z.number().nullish(),
  mintDisabled: z.boolean().nullish(),
  meltDisabled: z.boolean().nullish(),
  software: z.string().nullish(),
  outdated: z.boolean().nullish(),
  isTest: z.boolean().nullish(),
  units: z.array(z.string()).nullish(),
  audit: z
    .looseObject({
      swaps7d: z.number().nullish(),
      attributedFailures: z.number().nullish(),
    })
    .nullish(),
  latency24h: z.looseObject({ p50Ms: z.number().nullish() }).nullish(),
});

type MintRadarMint = z.infer<typeof MintRadarMintSchema>;

function normalizeMintRadarStatus(raw?: string | null): MintAuditStatus {
  if (raw === 'online' || raw === 'offline' || raw === 'degraded' || raw === 'archived') {
    return raw;
  }
  return 'offline';
}

export function collectMintRadarWarnings(
  mint: MintRadarMint,
  status: MintAuditStatus,
  swaps?: { okCount: number; totalCount: number }
): MintAuditWarning[] {
  const warnings: MintAuditWarning[] = [];
  if (status === 'archived') {
    warnings.push({ code: 'archived' });
  } else if (status !== 'online') {
    warnings.push({ code: 'offline' });
  }
  if (
    status !== 'archived' &&
    typeof mint.uptime30dPct === 'number' &&
    Number.isFinite(mint.uptime30dPct) &&
    mint.uptime30dPct < AUDIT_THRESHOLDS.uptimePercent
  ) {
    warnings.push({
      code: 'lowUptime',
      params: { percent: Math.round(mint.uptime30dPct), threshold: AUDIT_THRESHOLDS.uptimePercent },
    });
  }
  if (swaps && swaps.totalCount >= AUDIT_THRESHOLDS.minSwaps) {
    const rate = Math.round((swaps.okCount / swaps.totalCount) * 100);
    if (rate < AUDIT_THRESHOLDS.successRatePercent) {
      warnings.push({
        code: 'lowSuccessRate',
        params: { percent: rate, threshold: AUDIT_THRESHOLDS.successRatePercent },
      });
    }
  }
  if (mint.mintDisabled === true) warnings.push({ code: 'mintDisabled' });
  if (mint.meltDisabled === true) warnings.push({ code: 'meltDisabled' });
  if (mint.outdated === true && mint.software) {
    warnings.push({ code: 'outdated', params: { software: mint.software } });
  }
  if (mint.isTest === true) warnings.push({ code: 'testMint' });
  return warnings;
}

function mapMintRadarItem(mint: MintRadarMint): AuditorMintEntry | null {
  if (!isValidMintUrl(mint.url)) return null;
  const status = normalizeMintRadarStatus(mint.status);
  const total = typeof mint.audit?.swaps7d === 'number' ? mint.audit.swaps7d : undefined;
  const failed = typeof mint.audit?.attributedFailures === 'number' ? mint.audit.attributedFailures : 0;
  const swaps = total && total > 0 ? { okCount: Math.max(total - failed, 0), totalCount: total } : undefined;
  const warnings = collectMintRadarWarnings(mint, status, swaps);

  return {
    source: 'mintradar',
    mintUrl: mint.url,
    name: cleanQuoted(mint.name),
    description: cleanQuoted(mint.description),
    iconUrl: cleanQuoted(mint.iconUrl ?? mint.icon_url),
    supportedUnits: mint.units?.map((u) => u.toLowerCase()),
    state: status === 'online' ? 'OK' : status === 'degraded' ? 'WARNING' : 'ERROR',
    status: status === 'online' ? 'online' : status === 'offline' || status === 'archived' ? 'offline' : 'unknown',
    testnut: mint.isTest === true,
    nMints: swaps?.okCount,
    nErrors: failed || undefined,
    auditScore: typeof mint.score === 'number' ? mint.score : undefined,
    uptime30d: typeof mint.uptime30dPct === 'number' ? mint.uptime30dPct : undefined,
    warnings,
  };
}

export async function fetchMintRadarDirectory(
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  const raw = await fetchAuditorJson(MINTRADAR_LIST_URL, 'mintradar', controls);
  if (!raw) return [];
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'object' && raw !== null && Array.isArray((raw as { mints?: unknown }).mints)
      ? (raw as { mints: unknown[] }).mints
      : [];
  const entries: AuditorMintEntry[] = [];
  for (const item of list) {
    const parsed = MintRadarMintSchema.safeParse(item);
    if (!parsed.success) continue;
    const mapped = mapMintRadarItem(parsed.data);
    if (mapped) entries.push(mapped);
  }
  return entries;
}

export async function fetchMintRadarSingle(
  mintUrl: string,
  controls: AuditorFetchControls = {}
): Promise<MintAuditSummary | undefined> {
  if (!isValidMintUrl(mintUrl)) return undefined;
  const raw = await fetchAuditorJson(
    `${MINTRADAR_LIST_URL}/${encodeURIComponent(mintUrl)}`,
    'mintradar',
    controls
  );
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = 'mint' in raw ? (raw as { mint: unknown }).mint : raw;
  const parsed = MintRadarMintSchema.safeParse(candidate);
  if (!parsed.success || !isValidMintUrl(parsed.data.url)) return undefined;
  const mint = parsed.data;
  const status = normalizeMintRadarStatus(mint.status);
  const total = typeof mint.audit?.swaps7d === 'number' ? mint.audit.swaps7d : undefined;
  const failed = typeof mint.audit?.attributedFailures === 'number' ? mint.audit.attributedFailures : 0;
  const swaps = total && total > 0 ? { okCount: Math.max(total - failed, 0), totalCount: total } : undefined;
  return {
    mintUrl: mint.url,
    status,
    score: typeof mint.score === 'number' ? mint.score : undefined,
    uptime24h: typeof mint.uptime24hPct === 'number' ? mint.uptime24hPct : undefined,
    uptime7d: typeof mint.uptime7dPct === 'number' ? mint.uptime7dPct : undefined,
    uptime30d: typeof mint.uptime30dPct === 'number' ? mint.uptime30dPct : undefined,
    latencyMs: typeof mint.latency24h?.p50Ms === 'number' ? mint.latency24h.p50Ms : undefined,
    swaps,
    warnings: collectMintRadarWarnings(mint, status, swaps),
    sources: ['mintradar'],
    auditUrl: `${MINTRADAR_SITE_URL}/${encodeURIComponent(mint.url)}`,
  };
}

// ---------------------------------------------------------------------------
// 2. Legacy Cashu Auditor (https://api.audit.8333.space/mints/)
// ---------------------------------------------------------------------------

const CashuAuditMintSchema = z.looseObject({
  url: z.string(),
  name: z.string().nullish(),
  info: z.string().nullish(),
  state: z.string().nullish(),
  n_errors: z.number().nullish(),
  n_mints: z.number().nullish(),
  n_melts: z.number().nullish(),
});

export async function fetchCashuAuditDirectory(
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  const raw = await fetchAuditorJson(CASHU_AUDIT_LIST_URL, 'cashu-audit', controls);
  if (!Array.isArray(raw)) return [];
  const entries: AuditorMintEntry[] = [];
  for (const item of raw) {
    const parsed = CashuAuditMintSchema.safeParse(item);
    if (!parsed.success || !isValidMintUrl(parsed.data.url)) continue;
    const row = parsed.data;
    const nut06 = parseNut06InfoJson(row.info);
    const state = row.state ?? 'UNKNOWN';
    entries.push({
      source: 'cashu-audit',
      mintUrl: row.url,
      name: nut06.name ?? cleanQuoted(row.name),
      description: nut06.description,
      iconUrl: nut06.iconUrl,
      nuts: nut06.nuts,
      supportedUnits: nut06.supportedUnits,
      operatorPubkey: nut06.operatorPubkey,
      state,
      status: state === 'OK' ? 'online' : state === 'ERROR' ? 'offline' : 'unknown',
      nMints: row.n_mints ?? undefined,
      nMelts: row.n_melts ?? undefined,
      nErrors: row.n_errors ?? undefined,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 3. IMF.gg (https://imf.gg/api/mints?page=1)
// ---------------------------------------------------------------------------

const ImfMintSchema = z.looseObject({
  url: z.string(),
  name: z.string().nullish(),
  info: z.string().nullish(),
  reviewCount: z.number().nullish(),
  reviewAvg: z.number().nullish(),
});

export async function fetchImfDirectory(
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  const raw = await fetchAuditorJson(IMF_LIST_URL, 'imf-gg', controls);
  if (!raw || typeof raw !== 'object') return [];
  const list = Array.isArray((raw as { mints?: unknown }).mints)
    ? (raw as { mints: unknown[] }).mints
    : [];
  const entries: AuditorMintEntry[] = [];
  for (const item of list) {
    const parsed = ImfMintSchema.safeParse(item);
    if (!parsed.success || !isValidMintUrl(parsed.data.url)) continue;
    const row = parsed.data;
    const nut06 = parseNut06InfoJson(row.info);
    entries.push({
      source: 'imf-gg',
      mintUrl: row.url,
      name: nut06.name ?? cleanQuoted(row.name),
      description: nut06.description,
      iconUrl: nut06.iconUrl,
      nuts: nut06.nuts,
      supportedUnits: nut06.supportedUnits,
      operatorPubkey: nut06.operatorPubkey,
      reviewCount: typeof row.reviewCount === 'number' ? row.reviewCount : undefined,
      averageScore: typeof row.reviewAvg === 'number' ? row.reviewAvg : undefined,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 4. Nostr NIP-87 (kinds 38172 + 38000 via local Nostr facade)
// ---------------------------------------------------------------------------

export async function fetchNip87Directory(
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  const layer = buildNostrDataLayer();
  if (!layer) return [];
  const res = await layer.discoverMints({ limit: 150 }, { signal: controls.signal });
  if (res.isErr()) return [];
  const entries: AuditorMintEntry[] = [];
  for (const mint of res.value.mints) {
    if (!isValidMintUrl(mint.mintUrl)) continue;
    entries.push({
      source: 'nip87',
      mintUrl: mint.mintUrl,
      name: cleanQuoted(mint.name),
      description: cleanQuoted(mint.description),
      iconUrl: cleanQuoted(mint.iconUrl),
      supportedUnits: mint.supportedUnits,
      operatorPubkey: mint.operatorPubkey,
      state: mint.state,
      nMints: mint.nMints,
      nMelts: mint.nMelts,
      nErrors: mint.nErrors,
      reviewCount: mint.reviewCount,
      averageScore: mint.averageRating,
    });
  }
  return entries;
}
