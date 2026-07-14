/**
 * Process-start safety checks. Destructive simulator work must not begin while
 * any durable fund liability is unresolved or any ledger cannot be validated.
 * The funded runtime consumes this audit before creating a new simulator and
 * attempts recovery through its separate resumable sweep seam.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { hasCustody } from './custody';
import {
  blockingLegsFromEntries,
  parseLedgerText,
  type AssetLocation,
  type LegStatus,
} from './ledger';

export interface StartupBlocker {
  ledgerPath: string;
  runId: string;
  legId: string;
  status:
    | Exclude<LegStatus, 'reconciled'>
    | 'corrupt'
    | 'invalid-custody'
    | 'orphan-custody'
    | 'effect-lease'
    | 'legacy-seed-records'
    | 'legacy-seed-artifact';
  asset?: AssetLocation;
  reason?: string;
  crashWindow: CrashWindow;
  resume: StartupResumeDecision;
}

export type CrashWindow =
  | 'intent-durable-effect-unconfirmed'
  | 'funded-durable-sweep-pending'
  | 'outflow-durable-sweep-pending'
  | 'sweep-durable-reconcile-pending'
  | 'sweep-durable-liability-remains'
  | 'ledger-unreadable'
  | 'custody-without-ledger'
  | 'value-effect-outcome-uncertain'
  | 'legacy-seed-material-unaccounted';

export interface StartupResumeDecision {
  action:
    | 'quarantine-before-any-effect'
    | 'restore-custody-then-quarantine'
    | 'repair-ledger-without-effects'
    | 'preserve-custody-without-effects';
  automaticValueEffectsAllowed: false;
}

export type StartupAudit =
  | { status: 'clean'; blockers: [] }
  | { status: 'blocked'; blockers: StartupBlocker[] };

function matchingFiles(root: string, matches: (name: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && matches(entry.name)) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

const NO_AUTOMATIC_EFFECTS = false as const;

function crashWindowFor(entries: ReturnType<typeof parseLedgerText>, legId: string): CrashWindow {
  const legEntries = entries.filter((entry) => entry.legId === legId);
  // Quarantine is the recovery policy, not a value transition. Preserve the
  // last confirmed value transition so a second crash cannot cause a retry.
  const latest = legEntries.filter((entry) => entry.kind !== 'quarantined').at(-1);
  if (latest?.kind === 'sweep') {
    return latest.ok && latest.residualAmount === 0
      ? 'sweep-durable-reconcile-pending'
      : 'sweep-durable-liability-remains';
  }
  if (latest?.kind === 'outflow') {
    return 'outflow-durable-sweep-pending';
  }
  if (latest?.kind === 'funded') {
    return 'funded-durable-sweep-pending';
  }
  return 'intent-durable-effect-unconfirmed';
}

const quarantineResume = (): StartupResumeDecision => ({
  action: 'quarantine-before-any-effect',
  automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
});

function seedExportRecordCount(path: string): number {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.includes('E2E_SEED_EXPORT') && !line.includes('[captured]')).length;
}

export function auditStartupLiabilities(root: string): StartupAudit {
  const blockers: StartupBlocker[] = [];
  const referencedCustody = new Set<string>();
  for (const path of matchingFiles(root, (name) => name === 'ledger.jsonl')) {
    const ledgerPath = relative(root, path) || 'ledger.jsonl';
    try {
      const entries = parseLedgerText(readFileSync(path, 'utf8'));
      const runBase = dirname(path);
      for (const entry of entries) {
        if (entry.kind === 'intent') {
          referencedCustody.add(
            relative(root, join(runBase, 'custody', `${entry.custody.id}.secret`))
          );
        }
      }
      const runIds = new Set(entries.map((entry) => entry.runId));
      if (runIds.size > 1) throw new Error('ledger corrupt — multiple run ids');
      const runId = entries[0]?.runId ?? 'unknown';
      for (const liability of blockingLegsFromEntries(entries)) {
        const intent = entries.find(
          (entry) => entry.kind === 'intent' && entry.legId === liability.legId
        );
        if (!intent || intent.kind !== 'intent') {
          throw new Error(`ledger corrupt — leg "${liability.legId}" has no intent`);
        }
        if (!hasCustody(runBase, intent.custody)) {
          blockers.push({
            ledgerPath,
            runId,
            legId: liability.legId,
            status: 'invalid-custody',
            asset: liability.asset,
            reason: 'run-relative recovery custody failed content validation',
            crashWindow: crashWindowFor(entries, liability.legId),
            resume: {
              action: 'restore-custody-then-quarantine',
              automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
            },
          });
        } else {
          blockers.push({
            ledgerPath,
            runId,
            ...liability,
            crashWindow: crashWindowFor(entries, liability.legId),
            resume: quarantineResume(),
          });
        }
      }
    } catch (error) {
      blockers.push({
        ledgerPath,
        runId: 'unknown',
        legId: 'unknown',
        status: 'corrupt',
        reason: error instanceof Error ? error.message : 'ledger validation failed',
        crashWindow: 'ledger-unreadable',
        resume: {
          action: 'repair-ledger-without-effects',
          automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
        },
      });
    }
  }
  for (const path of matchingFiles(root, (name) => name.endsWith('.secret'))) {
    const custodyPath = relative(root, path);
    if (referencedCustody.has(custodyPath)) continue;
    blockers.push({
      ledgerPath: custodyPath,
      runId: 'unknown',
      legId: 'unknown',
      status: 'orphan-custody',
      reason: 'recovery custody is not referenced by a durable ledger',
      crashWindow: 'custody-without-ledger',
      resume: {
        action: 'preserve-custody-without-effects',
        automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
      },
    });
  }
  for (const path of matchingFiles(root, (name) => name.endsWith('.lock'))) {
    if (basename(dirname(path)) !== 'effect-leases') continue;
    blockers.push({
      ledgerPath: relative(root, path),
      runId: 'unknown',
      legId: 'unknown',
      status: 'effect-lease',
      reason:
        'a durable value-effect lease was retained; the prior effect outcome may be uncertain',
      crashWindow: 'value-effect-outcome-uncertain',
      resume: {
        action: 'repair-ledger-without-effects',
        automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
      },
    });
  }
  for (const path of matchingFiles(root, (name) => /^metro(?:[.-].*)?\.log$/i.test(name))) {
    const count = seedExportRecordCount(path);
    if (count === 0) continue;
    blockers.push({
      ledgerPath: relative(root, path),
      runId: 'unknown',
      legId: 'unknown',
      status: 'legacy-seed-records',
      reason: `${count} seed-export records lack a run-relative liability ledger`,
      crashWindow: 'legacy-seed-material-unaccounted',
      resume: {
        action: 'preserve-custody-without-effects',
        automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
      },
    });
  }
  for (const path of matchingFiles(root, (name) => /^legacy[-_.].*seeds?\.json$/i.test(name))) {
    blockers.push({
      ledgerPath: relative(root, path),
      runId: 'unknown',
      legId: 'unknown',
      status: 'legacy-seed-artifact',
      reason: 'legacy seed artifact lacks a machine-readable run-relative reconciliation record',
      crashWindow: 'legacy-seed-material-unaccounted',
      resume: {
        action: 'preserve-custody-without-effects',
        automaticValueEffectsAllowed: NO_AUTOMATIC_EFFECTS,
      },
    });
  }
  blockers.sort((a, b) =>
    `${a.runId}\u0000${a.legId}\u0000${a.ledgerPath}`.localeCompare(
      `${b.runId}\u0000${b.legId}\u0000${b.ledgerPath}`
    )
  );
  return blockers.length === 0
    ? { status: 'clean', blockers: [] }
    : { status: 'blocked', blockers };
}

export function assertNoStartupLiabilities(root: string): void {
  const audit = auditStartupLiabilities(root);
  if (audit.status === 'clean') return;
  const corrupt = audit.blockers.filter((blocker) => blocker.status === 'corrupt').length;
  const suffix = corrupt > 0 ? ` (${corrupt} corrupt ledger${corrupt === 1 ? '' : 's'})` : '';
  throw new Error(
    `${audit.blockers.length} unresolved fund liabilities block destructive startup${suffix}`
  );
}
