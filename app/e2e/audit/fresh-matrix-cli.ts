#!/usr/bin/env bun
/* eslint-disable no-console -- human-facing audit boundary */

import { runWorkspaceFreshMatrixAudit } from './fresh-matrix';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--cutoff' || !args[1]) {
  console.error('usage: bun e2e/audit/fresh-matrix-cli.ts --cutoff <ISO-8601 timestamp>');
  process.exit(2);
}

const result = await runWorkspaceFreshMatrixAudit(args[1]);
result.match(
  (report) => {
    console.log(`[e2e matrix] cutoff ${report.cutoff}`);
    console.log(`[e2e matrix] source ${report.sourceFingerprint}`);
    console.log(
      `[e2e matrix] coverage ${report.covered}/${report.expected} ` +
        `(iOS ${report.platforms.ios.covered}/${report.platforms.ios.expected}, ` +
        `Android ${report.platforms.android.covered}/${report.platforms.android.expected})`
    );
    if (report.runs.length > 0) {
      console.log('[e2e matrix] contributing product runs:');
      for (const run of report.runs) console.log(`  run-${run.runId} (${run.pairs} pair(s))`);
    }
    if (report.missing.length > 0) {
      console.log(`[e2e matrix] missing ${report.missing.length} pair(s):`);
      for (const pair of report.missing) {
        console.log(`  ${pair.scenarioId}|${pair.platform} — ${pair.reasons.join('; ')}`);
      }
    }

    const exactGreen =
      report.scenarios === 125 &&
      report.expected === 213 &&
      report.covered === 213 &&
      report.missing.length === 0 &&
      report.complete;
    if (exactGreen) console.log('[e2e matrix] ✓ strict fresh matrix is 213/213 green');
    process.exitCode = exactGreen ? 0 : 1;
  },
  (error) => {
    console.error(`[e2e matrix] ✗ ${error.message}`);
    process.exitCode = 2;
  }
);
