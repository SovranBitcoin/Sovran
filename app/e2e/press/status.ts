/* eslint-disable no-console -- press CLI boundary */
/**
 * Which screenshots still show the current app?
 *
 *   bun run screenshots:status            # report
 *   bun run screenshots:status --strict   # exit 1 unless every capturable screenshot is current
 *   bun run screenshots:status --json
 *
 * A capture is current only when its recorded app-source fingerprint equals
 * the fingerprint of the working tree. Anything else needs
 * `bun run screenshots:refresh`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appFilesChangedSince,
  appSourceFingerprint,
  classifyCapture,
  type CaptureFreshness,
} from '../../../scripts/lib/app-source.mjs';
import { createPressPlan, ROOT } from './plan';
import type { RegistryEntry } from './promote';

export type StatusRow = {
  key: string;
  state: CaptureFreshness;
  capturable: boolean;
  capturedAt?: string;
  changedFiles?: string[];
  reason?: string;
};

export function screenshotStatus(root = ROOT): {
  fingerprint: string | undefined;
  rows: StatusRow[];
} {
  const registry = JSON.parse(
    readFileSync(join(root, 'press/artwork/source/screenshots.json'), 'utf8')
  ) as Record<string, RegistryEntry>;
  const plan = createPressPlan(['ios', 'android'], root);
  const capturable = new Set(plan.captures.map((capture) => capture.key));
  const fingerprint = appSourceFingerprint(root);
  const keys = [...new Set([...Object.keys(registry), ...capturable])].sort();
  const rows = keys.map((key): StatusRow => {
    const entry = registry[key];
    const state = classifyCapture(entry, fingerprint);
    return {
      key,
      state,
      capturable: capturable.has(key),
      ...(entry?.capturedAt ? { capturedAt: entry.capturedAt } : {}),
      ...(state === 'outdated' && entry?.appSource?.gitSha
        ? { changedFiles: appFilesChangedSince(root, entry.appSource.gitSha) }
        : {}),
      ...(state === 'withdrawn'
        ? { reason: entry?.staleReason ?? entry?.unavailableReason ?? 'withdrawn' }
        : {}),
    };
  });
  return { fingerprint, rows };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--strict' && arg !== '--json'))
    throw new Error('Usage: bun run screenshots:status [--strict] [--json]');
  const { fingerprint, rows } = screenshotStatus();
  if (args.includes('--json')) console.log(JSON.stringify({ fingerprint, rows }, null, 2));
  else {
    console.log(`App source fingerprint: ${fingerprint ?? 'unavailable'}`);
    const order: CaptureFreshness[] = [
      'outdated',
      'unverified',
      'withdrawn',
      'missing',
      'unknown',
      'current',
    ];
    for (const state of order) {
      const group = rows.filter((row) => row.state === state);
      if (!group.length) continue;
      console.log(`\n${state} (${group.length})`);
      for (const row of group)
        console.log(
          `  ${row.key}${row.capturable ? '' : ' [no capture journey]'}${row.capturedAt ? ` — captured ${row.capturedAt}` : ''}${
            row.changedFiles?.length
              ? ` — ${row.changedFiles.length} app files changed, e.g. ${row.changedFiles.slice(0, 3).join(', ')}`
              : ''
          }${row.reason ? ` — ${row.reason}` : ''}`
        );
    }
    const stale = rows.filter((row) => row.capturable && row.state !== 'current');
    console.log(
      `\n${stale.length ? `${stale.length} capturable screenshots need bun run screenshots:refresh.` : 'Every capturable screenshot is current.'}`
    );
  }
  if (args.includes('--strict') && rows.some((row) => row.capturable && row.state !== 'current'))
    process.exitCode = 1;
}
