/**
 * Upstream-feedback capture for the @cashu/coco v2 migration.
 *
 * Purpose: when coco v2 misbehaves on real devices, we want enough structured
 * detail to file a useful issue against cashubtc/coco — exact package
 * versions, which coco API failed with which coco error CLASS (names are
 * upstream's vocabulary: QuoteIdentityConflictError, UnitMismatchError, …),
 * migration anomalies, and projection inconsistencies. Everything logs under
 * the `coco.feedback.*` prefix so one query collects the whole story:
 *
 *   - log-doctor:  `bunx tsx codereview/log-doctor/index.ts upstream`
 *   - on device:   Settings → Storage → "Copy coco v2 feedback report"
 *
 * Same redaction rules as everything else: error names + message LENGTHS,
 * counts, and ids — never invoices, offers, addresses, tokens, or mint URLs.
 */

import { cashuLog, log } from '@/shared/lib/logger';
import type { LogEntry } from '@/shared/lib/loggerCore';

// The app pins these dependencies EXACTLY (no ^ ranges — see app/package.json
// and the PR's artifact-parity gate), so the pins ARE the installed versions.
// Metro cannot bundle dynamic require() and coco's exports map hides
// package.json subpaths, so runtime resolution isn't an option here — keep
// these in lockstep with the package.json pins when bumping coco/cashu-ts.
export const COCO_VERSIONS = {
  cocoCore: '2.0.0-rc.2',
  cocoReact: '2.0.0-rc.2',
  cocoExpoSqlite: '2.0.0-rc.2',
  cashuTs: '4.5.1',
} as const;

/** Log the installed coco/cashu-ts versions once per manager init so every
 *  feedback report is version-stamped. */
export function logCocoVersions(): void {
  cashuLog.info('coco.feedback.versions', { ...COCO_VERSIONS });
}

/**
 * Error-class names coco v2 / cashu-ts v4 throw. Recognizing one means the
 * failure is expressed in upstream's own vocabulary — exactly what a
 * maintainer wants in a report.
 */
const COCO_ERROR_NAMES = new Set([
  'QuoteIdentityConflictError',
  'UnitMismatchError',
  'UnitValidationError',
  'ProofValidationError',
  'ProofOperationError',
  'MintOperationError',
  'OperationInProgressError',
  'MintFetchError',
  'KeysetSyncError',
  'TokenValidationError',
  'PaymentRequestError',
  'UnknownMintError',
  'KeyPairNotFoundError',
  'AuthSessionError',
  'AuthSessionExpiredError',
  'NetworkError',
  'HttpResponseError',
]);

function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      isCocoErrorClass: COCO_ERROR_NAMES.has(error.name),
      messageLength: error.message.length,
      // Coco error messages are diagnostic text (states, ids, counts) — but a
      // few embed the mint's raw response; cap and rely on the logger's
      // secret-pattern redaction for the rest.
      message: error.message.slice(0, 200),
    };
  }
  return { errorName: typeof error, isCocoErrorClass: false };
}

/**
 * Record a coco v2 anomaly worth reporting upstream. `area` becomes the
 * queryable suffix: `coco.feedback.<area>`. Params must follow log-doctor
 * conventions (flat, no payment strings).
 */
export function reportCocoIssue(area: string, params: Record<string, unknown> = {}): void {
  cashuLog.warn(`coco.feedback.${area}`, { ...params, ...COCO_VERSIONS });
}

/** Record a failed coco API call with upstream's error vocabulary attached. */
export function reportCocoApiFailure(
  api: string,
  error: unknown,
  params: Record<string, unknown> = {}
): void {
  reportCocoIssue('api_failure', { api, ...errorFields(error), ...params });
}

// ---------------------------------------------------------------------------
// On-device report (release builds have no log-doctor; Settings → Storage
// exposes this as "Copy coco v2 feedback report").
// ---------------------------------------------------------------------------

const RELEVANT_EVENT = /^(coco\.|cashu\.|quotes\.|operations\.|colada\.|history\.projection)/;

function isFeedbackRelevant(entry: LogEntry): boolean {
  if (entry.event.startsWith('coco.feedback.')) return true;
  if (entry.level !== 'warn' && entry.level !== 'error' && entry.level !== 'fatal') return false;
  return RELEVANT_EVENT.test(entry.event);
}

/**
 * Build a paste-ready digest of everything upstream-relevant currently in the
 * log ring buffer: versions header, grouped warn/error events with counts and
 * a sample param set each. Content has already been through the logger's
 * redaction; this only reshapes it.
 */
export function buildCocoFeedbackReport(): string {
  const entries = log.getRecentLogs().filter(isFeedbackRelevant);
  const lines: string[] = [
    '## coco v2 field report (sovran-app)',
    '',
    `versions: coco-core ${COCO_VERSIONS.cocoCore}, coco-react ${COCO_VERSIONS.cocoReact}, ` +
      `coco-expo-sqlite ${COCO_VERSIONS.cocoExpoSqlite}, cashu-ts ${COCO_VERSIONS.cashuTs}`,
    '',
  ];

  if (entries.length === 0) {
    lines.push('No coco-related warnings, errors, or feedback events in the recent log buffer.');
    return lines.join('\n');
  }

  const groups = new Map<string, { count: number; level: string; first: LogEntry }>();
  for (const entry of entries) {
    const existing = groups.get(entry.event);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(entry.event, { count: 1, level: entry.level, first: entry });
    }
  }

  lines.push(`${entries.length} relevant entries across ${groups.size} distinct events:`, '');
  const sorted = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [event, group] of sorted) {
    const params = group.first.params
      ? Object.entries(group.first.params)
          .slice(0, 8)
          .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
          .join(' ')
      : '';
    lines.push(`- [${group.level}] ${event} ×${group.count}${params ? ` — ${params}` : ''}`);
  }

  return lines.join('\n');
}
