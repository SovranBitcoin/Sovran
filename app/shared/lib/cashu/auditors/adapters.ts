import { z } from 'zod';
import { buildAbortSignal } from '@/shared/lib/http/requestSignal';
import { apiLog } from '@/shared/lib/logger';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { extractMintNostrPubkey } from '@/shared/lib/nostr/extractMintNostrPubkey';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import type { AuditObservationUpdate } from './observation';
import {
  AUDIT_THRESHOLDS,
  auditorDescriptor,
  type CdkAuditorId,
  type MintAuditorId,
  type MintAuditStatus,
  type MintAuditSummary,
  type MintAuditWarning,
} from './registry';

const AUDITOR_TIMEOUT_MS = 8_000;

export const MINTRADAR_LIST_URL = 'https://mintradar.org/api/v1/wallets/mints';
const MINTRADAR_SITE_URL = 'https://mintradar.org/mint';
export const CASHU_AUDIT_LIST_URL = 'https://api.audit.8333.space/mints/';
export const IMF_LIST_URL = 'https://imf.gg/api/mints';
/** Directory pages read per auditor, at most: a broken server never loops. */
export const AUDITOR_MAX_PAGES = 20;

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
  /** This source's typed reading, kept per source on the cached mint row. */
  observation?: AuditObservationUpdate;
}

export interface AuditorFetchControls {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function fetchAuditorJson(
  url: string,
  source: MintAuditorId,
  controls: AuditorFetchControls = {},
  init: { form?: Record<string, string> } = {}
): Promise<unknown> {
  const { form } = init;
  // eslint-disable-next-line no-restricted-globals -- public third-party auditor endpoints
  const response = await fetch(url, {
    method: form ? 'POST' : 'GET',
    headers: form
      ? { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
      : { Accept: 'application/json' },
    ...(form ? { body: encodeForm(form) } : {}),
    signal: buildAbortSignal({
      timeoutMs: controls.timeoutMs ?? AUDITOR_TIMEOUT_MS,
      ...controls,
    }),
  });
  if (!response.ok) {
    apiLog.debug('cashu.auditor.http_error', { source, status: response.status });
    throw new Error(`${source} HTTP ${response.status}`);
  }
  return await response.json();
}

/** `application/x-www-form-urlencoded`, without relying on React Native's partial URLSearchParams. */
function encodeForm(form: Record<string, string>): string {
  return Object.entries(form)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }
}

const finiteOrUndefined = (value: number | null | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Read a paged directory: `page` from `first` until a page brings nothing new,
 * the reported `total` is reached, or `AUDITOR_MAX_PAGES` pages were read.
 * Rows are de-duplicated by normalized mint URL, first seen wins. The first
 * page's failure is the source's failure; a later one keeps what was read.
 */
async function readPagedDirectory(
  source: MintAuditorId,
  first: 0 | 1,
  fetchPage: (page: number) => Promise<unknown>,
  controls: AuditorFetchControls
): Promise<unknown[]> {
  const rows: unknown[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < AUDITOR_MAX_PAGES; i++) {
    throwIfAborted(controls.signal);
    let raw: unknown;
    try {
      raw = await fetchPage(first + i);
    } catch (error) {
      if (i === 0 || controls.signal?.aborted) throw error;
      apiLog.debug('cashu.auditor.page_failed', { source, page: first + i });
      break;
    }
    const envelope =
      raw && typeof raw === 'object' ? (raw as { mints?: unknown; total?: unknown }) : {};
    const list = Array.isArray(envelope.mints) ? envelope.mints : [];
    let added = 0;
    for (const item of list) {
      const url = item && typeof item === 'object' ? (item as { url?: unknown }).url : undefined;
      const key = typeof url === 'string' ? normalizeMintUrlKey(url) : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(item);
      added += 1;
    }
    const total = typeof envelope.total === 'number' ? envelope.total : undefined;
    if (added === 0 || (total !== undefined && seen.size >= total)) break;
  }
  return rows;
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
  const trimmed = value
    .trim()
    .replace(/^"+|"+$/g, '')
    .trim();
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
      if (
        entry &&
        typeof entry === 'object' &&
        typeof (entry as { unit?: unknown }).unit === 'string'
      ) {
        const u = (entry as { unit: string }).unit.trim().toLowerCase();
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
    const contacts = (info.contact ?? []).filter(
      (c): c is { method: string; info: string } =>
        typeof c.method === 'string' && typeof c.info === 'string'
    );
    const operatorPubkey = extractMintNostrPubkey({ contact: contacts });
    const units = extractUnitsFromNuts(info.nuts);
    return {
      name: cleanQuoted(info.name),
      description: cleanQuoted(info.description),
      iconUrl: cleanQuoted(info.icon_url),
      nuts: info.nuts,
      supportedUnits: units.length > 0 ? units : undefined,
      operatorPubkey,
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
  const failed =
    typeof mint.audit?.attributedFailures === 'number' ? mint.audit.attributedFailures : 0;
  const swaps =
    total && total > 0 ? { okCount: Math.max(total - failed, 0), totalCount: total } : undefined;
  const warnings = collectMintRadarWarnings(mint, status, swaps);

  return {
    source: 'mintradar',
    mintUrl: mint.url,
    name: cleanQuoted(mint.name),
    description: cleanQuoted(mint.description),
    iconUrl: cleanQuoted(mint.iconUrl ?? mint.icon_url),
    supportedUnits: mint.units?.map((u) => u.toLowerCase()),
    state: status === 'online' ? 'OK' : status === 'degraded' ? 'WARNING' : 'ERROR',
    status:
      status === 'online'
        ? 'online'
        : status === 'offline' || status === 'archived'
          ? 'offline'
          : 'unknown',
    testnut: mint.isTest === true,
    nMints: swaps?.okCount,
    nErrors: failed || undefined,
    auditScore: typeof mint.score === 'number' ? mint.score : undefined,
    uptime30d: typeof mint.uptime30dPct === 'number' ? mint.uptime30dPct : undefined,
    warnings,
    observation: mintRadarObservation(mint, status, Date.now()),
  };
}

/**
 * MintRadar's reading: 24h uptime, 7-day swap probes with the failures it
 * attributes to the mint, and the 24h median probe latency.
 */
function mintRadarObservation(
  mint: MintRadarMint,
  status: MintAuditStatus,
  observedAt: number
): AuditObservationUpdate {
  const total = finiteOrUndefined(mint.audit?.swaps7d);
  const failed = finiteOrUndefined(mint.audit?.attributedFailures) ?? 0;
  const uptime = finiteOrUndefined(mint.uptime24hPct);
  const p50 = finiteOrUndefined(mint.latency24h?.p50Ms);
  return {
    source: 'mintradar',
    observedAt,
    status,
    uptime:
      uptime !== undefined && uptime >= 0 && uptime <= 100 ? { pct: uptime, window: '24h' } : null,
    operations:
      total !== undefined && total > 0
        ? {
            okCount: Math.max(0, Math.round(total - Math.min(Math.max(failed, 0), total))),
            totalCount: Math.round(total),
            window: '7d',
          }
        : null,
    latency: p50 !== undefined && p50 >= 0 ? { ms: p50, kind: 'median', window: '24h' } : null,
    sourceUrl: `${MINTRADAR_SITE_URL}/${encodeURIComponent(mint.url)}`,
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
): Promise<(MintAuditSummary & { observation: AuditObservationUpdate }) | undefined> {
  if (!isValidMintUrl(mintUrl)) return undefined;
  let raw: unknown;
  try {
    raw = await fetchAuditorJson(
      `${MINTRADAR_LIST_URL}/${encodeURIComponent(mintUrl)}`,
      'mintradar',
      controls
    );
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const candidate = 'mint' in raw ? (raw as { mint: unknown }).mint : raw;
  const parsed = MintRadarMintSchema.safeParse(candidate);
  if (!parsed.success || !isValidMintUrl(parsed.data.url)) return undefined;
  const mint = parsed.data;
  const status = normalizeMintRadarStatus(mint.status);
  const total = typeof mint.audit?.swaps7d === 'number' ? mint.audit.swaps7d : undefined;
  const failed =
    typeof mint.audit?.attributedFailures === 'number' ? mint.audit.attributedFailures : 0;
  const swaps =
    total && total > 0 ? { okCount: Math.max(total - failed, 0), totalCount: total } : undefined;
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
    observation: mintRadarObservation(mint, status, Date.now()),
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
      observation: countsObservation('cashu-audit', row, Date.now()),
    });
  }
  return entries;
}

function statusFromAuditorState(state: string | null | undefined): MintAuditStatus | undefined {
  const s = (state ?? '').toUpperCase();
  if (s === 'OK') return 'online';
  if (s === 'WARN' || s === 'WARNING') return 'degraded';
  if (s === 'ERROR') return 'offline';
  return undefined;
}

/**
 * The all-time operation counts the 8333 and CDK auditors keep: successful
 * mints plus melts, out of those plus errors (`n_errors` counts failures
 * separately; see `auditScoreFromOps`).
 */
function countsObservation(
  source: 'cashu-audit' | CdkAuditorId,
  row: {
    id?: unknown;
    state?: string | null;
    n_mints?: number | null;
    n_melts?: number | null;
    n_errors?: number | null;
  },
  observedAt: number
): AuditObservationUpdate {
  const mints = finiteOrUndefined(row.n_mints);
  const melts = finiteOrUndefined(row.n_melts);
  const errors = finiteOrUndefined(row.n_errors);
  const ok =
    mints !== undefined && melts !== undefined
      ? Math.max(0, Math.round(mints)) + Math.max(0, Math.round(melts))
      : undefined;
  const total = ok !== undefined && errors !== undefined ? ok + Math.max(0, Math.round(errors)) : 0;
  const id = row.id;
  return {
    source,
    observedAt,
    status: statusFromAuditorState(row.state) ?? null,
    operations:
      ok !== undefined && total > 0 ? { okCount: ok, totalCount: total, window: 'all' } : null,
    ...(typeof id === 'number' || typeof id === 'string' ? { auditorMintId: id } : {}),
  };
}

// ---------------------------------------------------------------------------
// 3. IMF.gg (https://imf.gg/api/mints?page=1..N)
// ---------------------------------------------------------------------------

// The live directory sends snake_case (`review_count`, `review_avg`); older
// responses used camelCase. Either is read.
const ImfMintSchema = z.looseObject({
  url: z.string(),
  name: z.string().nullish(),
  info: z.string().nullish(),
  review_count: z.number().nullish(),
  review_avg: z.number().nullish(),
  reviewCount: z.number().nullish(),
  reviewAvg: z.number().nullish(),
});

export async function fetchImfDirectory(
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  // imf.gg pages from 1 and answers past the end with an empty page.
  const rows = await readPagedDirectory(
    'imf-gg',
    1,
    (page) => fetchAuditorJson(`${IMF_LIST_URL}?page=${page}`, 'imf-gg', controls),
    controls
  );
  const entries: AuditorMintEntry[] = [];
  for (const item of rows) {
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
      reviewCount: finiteOrUndefined(row.review_count ?? row.reviewCount),
      averageScore: finiteOrUndefined(row.review_avg ?? row.reviewAvg),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 3b. CDK auditors (auditor.ucash.space, auditor.regtest.macadamia.cash)
//
// cashubtc/cdk's auditor serves Leptos server functions: form-encoded POSTs
// to `/api/<name><suffix>`. The directory pages from 0. Per-mint uptime and
// metrics are separate calls, made only by the mint info page, never once per
// directory row.
// ---------------------------------------------------------------------------

const CdkMintRowSchema = z.looseObject({
  id: z.union([z.number().int().nonnegative(), z.string().max(128)]),
  url: z.string(),
  name: z.string().nullish(),
  info: z.string().nullish(),
  state: z.string().nullish(),
  n_errors: z.number().nullish(),
  n_mints: z.number().nullish(),
  n_melts: z.number().nullish(),
});

type CdkMintRow = z.infer<typeof CdkMintRowSchema>;

const CdkUptimeSchema = z.looseObject({
  window_hours: z.number().nullish(),
  checks: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative().nullish(),
  failures: z.number().int().nonnegative().nullish(),
  uptime_percent: z.number().nullish(),
});

const CdkMetricsSchema = z.looseObject({
  attempts: z.number().nonnegative().nullish(),
  successes: z.number().nonnegative().nullish(),
  attempts_24h: z.number().nonnegative().nullish(),
  successes_24h: z.number().nonnegative().nullish(),
  avg_latency_ms: z.number().nullish(),
  avg_latency_ms_24h: z.number().nullish(),
});

type CdkMintUptime = z.infer<typeof CdkUptimeSchema>;
type CdkMintMetrics = z.infer<typeof CdkMetricsSchema>;

function cdkRoute(id: CdkAuditorId, name: string): string {
  const descriptor = auditorDescriptor(id);
  if (!descriptor?.endpoint || descriptor.functionSuffix === undefined) {
    throw new Error(`${id} has no CDK endpoint`);
  }
  return `${descriptor.endpoint}/api/${name}${descriptor.functionSuffix}`;
}

function cdkSearch(
  id: CdkAuditorId,
  search: string,
  page: number,
  controls: AuditorFetchControls
): Promise<unknown> {
  return fetchAuditorJson(cdkRoute(id, 'search_mints'), id, controls, {
    form: { search, page: String(page) },
  });
}

function mapCdkRow(id: CdkAuditorId, row: CdkMintRow, observedAt: number): AuditorMintEntry {
  const nut06 = parseNut06InfoJson(row.info);
  const status = statusFromAuditorState(row.state);
  return {
    source: id,
    mintUrl: row.url,
    name: nut06.name ?? cleanQuoted(row.name),
    description: nut06.description,
    iconUrl: nut06.iconUrl,
    nuts: nut06.nuts,
    supportedUnits: nut06.supportedUnits,
    operatorPubkey: nut06.operatorPubkey,
    state: row.state ?? undefined,
    status: status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'unknown',
    // No test-mint verdict here: an auditor's own hostname says nothing about
    // each mint it watches, so `testnut` is left to the sources that classify.
    nMints: finiteOrUndefined(row.n_mints),
    nMelts: finiteOrUndefined(row.n_melts),
    nErrors: finiteOrUndefined(row.n_errors),
    observation: countsObservation(id, row, observedAt),
  };
}

/** Every mint one CDK auditor lists, with its all-time counts. */
export async function fetchCdkDirectory(
  id: CdkAuditorId,
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  const rows = await readPagedDirectory(
    id,
    0,
    (page) => cdkSearch(id, '', page, controls),
    controls
  );
  const now = Date.now();
  const entries: AuditorMintEntry[] = [];
  for (const item of rows) {
    const parsed = CdkMintRowSchema.safeParse(item);
    if (!parsed.success || !isValidMintUrl(parsed.data.url)) continue;
    entries.push(mapCdkRow(id, parsed.data, now));
  }
  return entries;
}

export const fetchUcashDirectory = (controls?: AuditorFetchControls) =>
  fetchCdkDirectory('ucash', controls);
export const fetchMacadamiaDirectory = (controls?: AuditorFetchControls) =>
  fetchCdkDirectory('macadamia', controls);

/**
 * One mint's row on a CDK auditor, found by searching for its host (one
 * request). `undefined` when the auditor does not list it or cannot answer.
 */
export async function findCdkMint(
  id: CdkAuditorId,
  mintUrl: string,
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry | undefined> {
  let host: string;
  try {
    host = new URL(mintUrl).host;
  } catch {
    return undefined;
  }
  const target = normalizeMintUrlKey(mintUrl);
  try {
    const raw = await cdkSearch(id, host, 0, controls);
    const list =
      raw && typeof raw === 'object' && Array.isArray((raw as { mints?: unknown }).mints)
        ? (raw as { mints: unknown[] }).mints
        : [];
    for (const item of list) {
      const parsed = CdkMintRowSchema.safeParse(item);
      if (!parsed.success || normalizeMintUrlKey(parsed.data.url) !== target) continue;
      return mapCdkRow(id, parsed.data, Date.now());
    }
  } catch {
    // A source that cannot answer is a soft failure for the page.
  }
  return undefined;
}

async function cdkDetail<T>(
  id: CdkAuditorId,
  name: string,
  auditorMintId: number | string,
  schema: z.ZodType<T>,
  controls: AuditorFetchControls
): Promise<T | undefined> {
  try {
    const raw = await fetchAuditorJson(cdkRoute(id, name), id, controls, {
      form: { id: String(auditorMintId) },
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      apiLog.debug('cashu.auditor.detail_shape', { source: id, name });
      return undefined;
    }
    return parsed.data;
  } catch {
    // 404, 5xx, timeouts and bad JSON all mean "nothing from this source now".
    return undefined;
  }
}

export const fetchCdkMintUptime = (
  id: CdkAuditorId,
  auditorMintId: number | string,
  controls: AuditorFetchControls = {}
) => cdkDetail(id, 'get_mint_uptime', auditorMintId, CdkUptimeSchema, controls);

export const fetchCdkMintMetrics = (
  id: CdkAuditorId,
  auditorMintId: number | string,
  controls: AuditorFetchControls = {}
) => cdkDetail(id, 'get_mint_metrics', auditorMintId, CdkMetricsSchema, controls);

/**
 * A CDK auditor's per-mint detail as an observation update. Uptime counts only
 * when some check ran. Both live auditors report `avg_latency_ms_24h: 0.0`
 * when no probe succeeded in 24h, so that mean is read only with
 * `successes_24h > 0`; otherwise the all-time mean stands in, with
 * `successes > 0`. A call that did not answer leaves its group alone.
 */
export function cdkDetailObservation(
  id: CdkAuditorId,
  detail: { uptime?: CdkMintUptime; metrics?: CdkMintMetrics },
  observedAt: number
): AuditObservationUpdate {
  const update: AuditObservationUpdate = { source: id, observedAt };
  const { uptime, metrics } = detail;
  if (uptime) {
    const pct = finiteOrUndefined(uptime.uptime_percent);
    update.uptime =
      uptime.checks > 0 && pct !== undefined && pct >= 0 && pct <= 100
        ? { pct, window: '24h', checks: uptime.checks }
        : null;
  }
  if (metrics) {
    const recent = finiteOrUndefined(metrics.avg_latency_ms_24h);
    const allTime = finiteOrUndefined(metrics.avg_latency_ms);
    if ((metrics.successes_24h ?? 0) > 0 && recent !== undefined && recent > 0) {
      update.latency = { ms: recent, kind: 'mean', window: '24h' };
    } else if ((metrics.successes ?? 0) > 0 && allTime !== undefined && allTime > 0) {
      update.latency = { ms: allTime, kind: 'mean', window: 'all' };
    } else {
      update.latency = null;
    }
  }
  return update;
}

// ---------------------------------------------------------------------------
// 4. Nostr NIP-87 (kinds 38172 + 38000 via local Nostr facade)
// ---------------------------------------------------------------------------

export async function fetchNip87Directory(
  controls: AuditorFetchControls = {}
): Promise<AuditorMintEntry[]> {
  const layer = buildNostrDataLayer();
  if (!layer) return [];
  const res = await layer.discoverMints({ limit: 150, signal: controls.signal });
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
      operatorPubkey: mint.operatorPubkey
        ? extractMintNostrPubkey({ contact: [{ method: 'nostr', info: mint.operatorPubkey }] })
        : undefined,
      state: mint.state,
      nMints: mint.nMints,
      nMelts: mint.nMelts,
      nErrors: mint.nErrors,
      reviewCount: mint.reviewCount,
      averageScore: mint.averageScore ?? undefined,
    });
  }
  return entries;
}
