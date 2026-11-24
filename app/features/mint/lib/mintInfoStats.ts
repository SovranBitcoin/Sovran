/**
 * The four numbers Mint Info leads with, chosen from the per-source auditor
 * readings on the cached mint row.
 *
 * Each number comes from exactly one source, named under it, in a fixed order
 * of preference:
 *
 * - **24h uptime**: MintRadar's 24h figure, else a CDK auditor's (uCash, then
 *   Macadamia) when at least one check ran.
 * - **Operation success**: successes over attempts, both from ONE source:
 *   MintRadar's 7-day swap probes less the failures it blames on the mint,
 *   else a CDK auditor's mints plus melts against its errors, else the saved
 *   8333 audit. A numerator is never paired with another source's total.
 * - **Probe latency**: MintRadar's 24h median, else a CDK auditor's 24h mean,
 *   else an all-time mean (CDK, then the saved audit).
 * - **Operations sampled**: the total behind Operation success, same source,
 *   same window.
 *
 * Pure: no store, network or React, so the precedence is unit-tested alone.
 */
import {
  observationFrom,
  type AuditObservation,
  type AuditObservationSource,
} from '@/shared/lib/cashu/auditors/observation';
import { formatRate } from '@/shared/lib/number';
import type { MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';
import { UNKNOWN_STAT, type GridStat } from '@/shared/ui/composed/StatsGrid';
import { selectMintAudit } from './auditInfo';

/** `saved`: counts cached before per-source readings existed. */
export type MintStatSource = AuditObservationSource | 'saved';

type OpsWindow = NonNullable<AuditObservation['operations']>['window'];
type LatencyWindow = NonNullable<AuditObservation['latency']>['window'];

export interface MintInfoStats {
  uptime?: { pct: number; source: MintStatSource; checks?: number };
  operations?: { okCount: number; totalCount: number; window: OpsWindow; source: MintStatSource };
  latency?: {
    ms: number;
    kind: 'median' | 'mean';
    window: LatencyWindow;
    source: MintStatSource;
  };
}

const CDK_SOURCES = ['ucash', 'macadamia'] as const;

const MINT_STAT_SOURCE_NAMES: Record<MintStatSource, string> = {
  mintradar: 'MintRadar',
  ucash: 'uCash',
  macadamia: 'Macadamia',
  'cashu-audit': 'Cashu Auditor',
  saved: 'Saved audit',
};

function validOps(ops: AuditObservation['operations']): ops is NonNullable<typeof ops> {
  return (
    !!ops &&
    Number.isInteger(ops.okCount) &&
    Number.isInteger(ops.totalCount) &&
    ops.totalCount > 0 &&
    ops.okCount >= 0 &&
    ops.okCount <= ops.totalCount
  );
}

function selectUptime(entry: MintMetadataEntry): MintInfoStats['uptime'] {
  const map = entry.auditObservations;
  const radar = observationFrom(map, 'mintradar')?.uptime;
  if (radar) return { pct: radar.pct, source: 'mintradar' };
  for (const source of CDK_SOURCES) {
    const uptime = observationFrom(map, source)?.uptime;
    if (uptime && (uptime.checks ?? 0) > 0) {
      return { pct: uptime.pct, source, checks: uptime.checks };
    }
  }
  return undefined;
}

function selectOperations(entry: MintMetadataEntry): MintInfoStats['operations'] {
  const map = entry.auditObservations;
  for (const source of ['mintradar', ...CDK_SOURCES, 'cashu-audit'] as const) {
    const ops = observationFrom(map, source)?.operations;
    if (validOps(ops)) return { ...ops, source };
  }
  // Rows cached before per-source readings: the one audit summary the mint
  // rows show, whose successes and errors come from one auditor row.
  const saved = selectMintAudit(entry);
  if (saved?.totalOps && saved.totalOps > 0) {
    const okCount = (saved.mints ?? 0) + (saved.melts ?? 0);
    if (okCount <= saved.totalOps) {
      return { okCount, totalCount: saved.totalOps, window: 'all', source: 'saved' };
    }
  }
  return undefined;
}

function selectLatency(entry: MintMetadataEntry): MintInfoStats['latency'] {
  const map = entry.auditObservations;
  const radar = observationFrom(map, 'mintradar')?.latency;
  if (radar && radar.window === '24h') return { ...radar, source: 'mintradar' };
  for (const window of ['24h', 'all'] as const) {
    for (const source of CDK_SOURCES) {
      const latency = observationFrom(map, source)?.latency;
      if (latency && latency.window === window && latency.ms > 0) return { ...latency, source };
    }
  }
  const saved = selectMintAudit(entry)?.avgLatencyMs;
  if (typeof saved === 'number' && Number.isFinite(saved) && saved > 0) {
    return { ms: saved, kind: 'mean', window: 'all', source: 'saved' };
  }
  return undefined;
}

export function selectMintInfoStats(entry: MintMetadataEntry | undefined): MintInfoStats {
  if (!entry) return {};
  const stats: MintInfoStats = {};
  const uptime = selectUptime(entry);
  if (uptime) stats.uptime = uptime;
  const operations = selectOperations(entry);
  if (operations) stats.operations = operations;
  const latency = selectLatency(entry);
  if (latency) stats.latency = latency;
  return stats;
}

const OPS_WINDOW_LABEL: Record<OpsWindow, string> = {
  '7d': 'last 7 days',
  '24h': 'last 24h',
  all: 'all time',
};

/** What one source counts as an operation. */
function operationNoun(source: MintStatSource): string {
  return source === 'mintradar' ? 'Swap probes' : 'Mints and melts';
}

function latencyLabel(latency: NonNullable<MintInfoStats['latency']>): string {
  const kind = latency.kind === 'median' ? 'Median' : 'Average';
  return `${kind} (${latency.window === '24h' ? '24h' : 'all time'})`;
}

/** The four cards, in order, as `StatsGrid` renders them. */
export function mintInfoStatCards(stats: MintInfoStats): GridStat[] {
  const { uptime, operations, latency } = stats;
  const name = (source: MintStatSource) => MINT_STAT_SOURCE_NAMES[source];
  return [
    {
      label: '24h uptime',
      description: uptime
        ? uptime.checks
          ? `${name(uptime.source)} · ${uptime.checks} checks`
          : `${name(uptime.source)} · last 24h`
        : 'No checks in 24h',
      value: uptime ? formatRate(uptime.pct / 100) : UNKNOWN_STAT,
      placeholder: '99.9%',
      accent: true,
    },
    {
      label: 'Operation success',
      description: operations
        ? `${name(operations.source)} · ${OPS_WINDOW_LABEL[operations.window]}`
        : 'No operations sampled',
      value: operations ? formatRate(operations.okCount / operations.totalCount) : UNKNOWN_STAT,
      placeholder: '100%',
      accent: true,
    },
    {
      label: 'Probe latency',
      description: latency ? `${latencyLabel(latency)} · ${name(latency.source)}` : 'No sample',
      value: latency ? `${Math.round(latency.ms)} ms` : UNKNOWN_STAT,
      placeholder: '420 ms',
    },
    {
      label: 'Operations sampled',
      description: operations
        ? `${operationNoun(operations.source)} · ${OPS_WINDOW_LABEL[operations.window]}`
        : 'No operations sampled',
      value: operations ? operations.totalCount.toLocaleString('en-US') : UNKNOWN_STAT,
      placeholder: '12,345',
    },
  ];
}
