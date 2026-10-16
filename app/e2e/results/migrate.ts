/** One-time, non-destructive grouping of the former loose artifact layout. */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { alive, writeManifest } from './runs';

export function migrateResults(root: string): string[] {
  // Check every old owner before moving anything; its paths may still be in use.
  for (const rel of [
    'stories/.running',
    'cache/stories/.running',
    'screenshot-refresh.lock',
    'capture/screenshot-refresh.lock',
  ]) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, 'utf8').trim();
    let pid: unknown;
    try {
      const value: unknown = JSON.parse(text);
      pid = typeof value === 'object' && value !== null && 'pid' in value ? value.pid : value;
    } catch {
      throw new Error(`Unreadable lock: ${file}`);
    }
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)
      throw new Error(`Invalid lock: ${file}`);
    if (alive(pid)) throw new Error(`Results are in use by process ${pid}: ${file}`);
  }
  const moves: { from: string; to: string }[] = [];
  const plan = (from: string, to: string) => {
    if (existsSync(join(root, from))) moves.push({ from, to });
  };
  plan('stories', 'run-imported-stories/workers/imported/stories');
  plan('onboarding-resume', 'run-manual-onboarding-resume/evidence');
  plan('stories-tls', 'cache/stories-tls');
  plan('viewer-cache', 'cache/history/viewer');
  for (const name of readdirSync(root)) {
    if (/^screenshot-refresh.*\.json$/.test(name)) {
      const target = /^screenshot-refresh-/.test(name) ? 'capture/history' : 'capture';
      plan(name, `${target}/${name}`);
    } else if (/^library-.*\.log$/.test(name)) plan(name, `capture/logs/${name}`);
    else if (name === 'screenshot-refresh.lock') plan(name, `capture/history/${name}`);
  }
  for (const move of moves) {
    const runRoot =
      move.from === 'stories'
        ? 'run-imported-stories'
        : move.from === 'onboarding-resume'
          ? 'run-manual-onboarding-resume'
          : undefined;
    if (runRoot && existsSync(join(root, runRoot)))
      throw new Error(`Refusing to overwrite ${runRoot}`);
    if (existsSync(join(root, move.to))) throw new Error(`Refusing to overwrite ${move.to}`);
  }
  const importedAt = new Date().toISOString();
  for (const move of moves) {
    const target = join(root, move.to);
    mkdirSync(dirname(target), { recursive: true });
    if (move.from === 'stories') {
      const selected = readdirSync(join(root, 'stories'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('state-'))
        .map((entry) => entry.name);
      writeManifest(join(root, 'run-imported-stories'), {
        version: 1,
        kind: 'stories',
        suite: 'imported-stories',
        label: 'Imported story results (original run date unknown)',
        importedAt,
        selection: selected,
        state: { status: 'imported' },
      });
    }
    if (move.from === 'onboarding-resume') {
      writeManifest(join(root, 'run-manual-onboarding-resume'), {
        version: 1,
        kind: 'manual-review',
        suite: 'onboarding-resume',
        label: 'Onboarding manual review',
        importedAt,
        selection: [],
        state: { status: 'imported' },
      });
    }
    renameSync(join(root, move.from), target);
  }
  // Setup is retained alongside stories, but does not count as selected results.
  const imported = join(root, 'run-imported-stories/workers/imported');
  if (existsSync(join(imported, 'stories'))) {
    for (const entry of readdirSync(join(imported, 'stories'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('state-')) continue;
      mkdirSync(join(imported, 'setup'), { recursive: true });
      const target = join(imported, 'setup', entry.name);
      if (existsSync(target)) throw new Error(`Refusing to overwrite ${target}`);
      renameSync(join(imported, 'stories', entry.name), target);
    }
  }
  return moves.map(({ from, to }) => `${from} → ${to}`);
}

if (import.meta.main) {
  const root = new URL('../artifacts', import.meta.url).pathname;
  // eslint-disable-next-line no-console -- local maintenance CLI
  for (const moved of migrateResults(root)) console.log(moved);
}
