/* eslint-disable no-console -- capture status CLI */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appSourceFingerprint } from '../../../scripts/lib/app-source.mjs';
import { createCapturePlan, ROOT } from './plan';
import type { CaptureRecord } from './import';

export function screenshotStatus(root = ROOT) {
  const plan = createCapturePlan(['ios', 'android'], root);
  const library = join(root, 'press/screenshots');
  const manifest = join(library, 'manifest.json');
  const captures: CaptureRecord[] = existsSync(manifest)
    ? JSON.parse(readFileSync(manifest, 'utf8')).captures
    : [];
  if (!Array.isArray(captures)) throw new Error('Invalid capture manifest');
  const fingerprint = appSourceFingerprint(root);
  const rows = plan.targets.map((target) => {
    const key = `${target.platform}/${target.page}${target.state === 'default' ? '' : `--${target.state}`}`;
    const record = captures.find(
      (c) =>
        c.file === `${key}.png` &&
        c.scenario === target.scenario &&
        c.occurrence === target.occurrence
    );
    const recipe = plan.invocations.find(
      (i) => i.platform === target.platform && i.scenario === target.scenario
    );
    let state = target.status === 'blocked' ? 'blocked' : 'missing';
    if (record && target.status !== 'blocked') {
      try {
        const sha = createHash('sha256')
          .update(readFileSync(join(library, `${key}.png`)))
          .digest('hex');
        state =
          sha !== record.sha256
            ? 'corrupt'
            : !fingerprint
              ? 'unverified'
              : record.appSource.fingerprint === fingerprint &&
                  record.recipeSha256 === recipe?.recipeSha256
                ? 'current'
                : 'outdated';
      } catch {
        state = 'missing';
      }
    }
    return {
      key,
      baseline: target.baseline,
      state,
      scenario: target.scenario,
      reason: target.blocker,
      evidenceClass: record?.evidenceClass ?? target.evidenceClass,
      capturedAt: record?.capturedAt,
    };
  });
  return {
    fingerprint,
    baselineDenominator: plan.baselineDenominator,
    currentBaseline: rows.filter((row) => row.baseline && row.state === 'current').length,
    rows,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--strict', '--json'].includes(arg)))
    throw new Error('Usage: screenshots:status [--strict] [--json]');
  const status = screenshotStatus();
  if (args.includes('--json')) console.log(JSON.stringify(status, null, 2));
  else {
    console.log(
      `${status.currentBaseline}/${status.baselineDenominator} baseline screenshots current`
    );
    for (const state of ['blocked', 'missing', 'corrupt', 'outdated', 'unverified', 'current']) {
      const rows = status.rows.filter((row) => row.state === state);
      if (!rows.length) continue;
      console.log(`\n${state} (${rows.length})`);
      for (const row of rows) console.log(`  ${row.key}${row.reason ? `: ${row.reason}` : ''}`);
    }
  }
  if (args.includes('--strict') && status.rows.some((row) => row.state !== 'current'))
    process.exitCode = 1;
}
