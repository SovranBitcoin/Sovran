/**
 * @jest-environment node
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Guards that the blocking CI gates cover the whole workspace, not just `app/`.
 *
 * `wallet` (the payment engine, formerly colada) and `nostr` (the Nagg data
 * layer) joined this repo in the monorepo move, after v0.1.0. CI was never
 * extended with them: every gate ran `working-directory: app`, and the root
 * `test`/`type-check` scripts were `cd app && …` delegates, so wallet's 1183
 * vitest tests and nostr's 259 ran nowhere on a push. A change to either could
 * break every one of its own tests and still merge green.
 *
 * The fix is one canonical aggregate — the root scripts cover all workspaces —
 * used by both CI and humans. These tests fail if the
 * aggregate is narrowed back to a single package, or if a gate re-pins itself
 * to `app/`. A disposable extra workspace catches explicit package lists that
 * would silently omit a future package. Real Bun execution allows sequential
 * and parallel aggregates without pinning one command spelling.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS = path.join(REPO_ROOT, '.github/workflows');

const rootManifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  workspaces: string[];
  scripts: Record<string, string>;
};

/** Every workspace package that defines the given script. */
function packagesDefining(script: string): string[] {
  return rootManifest.workspaces.filter((workspace) => {
    const manifest = path.join(REPO_ROOT, workspace, 'package.json');
    if (!existsSync(manifest)) return false;
    const scripts = (
      JSON.parse(readFileSync(manifest, 'utf8')) as {
        scripts?: Record<string, string>;
      }
    ).scripts;
    return typeof scripts?.[script] === 'string';
  });
}

/** Run the actual aggregate against cheap stand-in suites, not the suites recursively. */
function aggregate(script: string, failingWorkspace?: string) {
  const fixture = mkdtempSync(path.join(tmpdir(), 'sovran-workspace-coverage-'));
  const workspaces = [...rootManifest.workspaces, 'future-package'];
  try {
    writeFileSync(
      path.join(fixture, 'package.json'),
      JSON.stringify({
        private: true,
        workspaces,
        scripts: rootManifest.scripts,
      })
    );
    writeFileSync(
      path.join(fixture, 'record.cjs'),
      `
      const fs = require('node:fs');
      const path = require('node:path');
      const workspace = path.basename(process.cwd());
      fs.appendFileSync('../executed.txt', workspace + '\\n');
      if (workspace === process.env.FAIL_WORKSPACE) process.exit(7);
    `
    );
    for (const workspace of workspaces) {
      const name: unknown =
        workspace === 'future-package'
          ? '@sovran/future-package'
          : JSON.parse(readFileSync(path.join(REPO_ROOT, workspace, 'package.json'), 'utf8')).name;
      if (typeof name !== 'string') throw new Error(`Missing package name: ${workspace}`);
      mkdirSync(path.join(fixture, workspace));
      writeFileSync(
        path.join(fixture, workspace, 'package.json'),
        JSON.stringify({
          name,
          scripts: { [script]: 'node ../record.cjs' },
        })
      );
    }
    const result = spawnSync('bun', ['run', script], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, FAIL_WORKSPACE: failingWorkspace ?? '' },
    });
    if (result.error) throw result.error;
    const recorded = path.join(fixture, 'executed.txt');
    return {
      status: result.status,
      signal: result.signal,
      executed: existsSync(recorded) ? readFileSync(recorded, 'utf8').trim().split('\n') : [],
      expected: workspaces,
    };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

interface Step {
  /** The command the step actually executes, not the surrounding comments. */
  run: string;
  /** Any working-directory pinning that applies, however it is spelled. */
  pinnedTo: string | null;
}

/**
 * The named step of a workflow, reduced to what decides coverage. Deliberately
 * strict: it reads the `run:` VALUE (a comment mentioning the command must not
 * satisfy the assertions), and it treats a `working-directory` anywhere in the
 * step — or a job-level `defaults.run.working-directory` — as pinning,
 * whatever the value, because these two gates must execute at the repo root.
 */
function step(workflow: string, name: string): Step {
  const source = readFileSync(path.join(WORKFLOWS, workflow), 'utf8');
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  if (start === -1) throw new Error(`step "${name}" not found in ${workflow}`);

  const indent = (lines[start] as string).search(/\S/);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const isBlank = line.trim() === '';
    if (!isBlank && line.search(/\S/) <= indent) break;
    body.push(line);
  }

  const runIndex = body.findIndex((line) => /^\s*run:/.test(line));
  if (runIndex === -1) throw new Error(`step "${name}" in ${workflow} has no run:`);
  const first = (body[runIndex] as string).replace(/^\s*run:\s*/, '');
  // `run: >-` / `run: |` continue on the following, more-indented lines.
  const run = /^[>|]/.test(first)
    ? body
        .slice(runIndex + 1)
        .filter((line) => line.trim() !== '')
        .map((line) => line.trim())
        .join(' ')
    : first.trim();

  const stepPin = body
    .find((line) => /^\s*working-directory:/.test(line))
    ?.replace(/^\s*working-directory:\s*/, '')
    .trim();

  // A job-level default pins every step in the job, including this one.
  const jobPin = /^\s*defaults:\s*\n\s*run:\s*\n\s*working-directory:\s*(.+)$/m
    .exec(source)?.[1]
    ?.trim();

  return { run, pinnedTo: stepPin ?? jobPin ?? null };
}

/**
 * The files TypeScript actually puts in a package's program.
 *
 * Asks `tsc` rather than reading `include` out of the tsconfig: the config text
 * cannot be reasoned about safely — `include: ["src", "__tests__"]` alongside
 * `exclude: ["__tests__"]` looks right and compiles nothing, and a legitimate
 * broad recursive glob looks wrong. `--listFilesOnly` enumerates the resolved
 * program without type-checking it, so this stays fast and does not duplicate
 * the type-check gate.
 */
function programFiles(workspace: string): string[] {
  const tsc = require.resolve('typescript/bin/tsc');
  const output = execFileSync(
    process.execPath,
    [tsc, '-p', path.join(REPO_ROOT, workspace), '--noEmit', '--listFilesOnly'],
    { encoding: 'utf8', cwd: REPO_ROOT }
  );
  return output.split('\n').filter(Boolean);
}

describe('CI covers every workspace package', () => {
  it.each(['test', 'type-check'])(
    'root `%s` fans out over the workspace rather than delegating to one package',
    (script) => {
      const result = aggregate(script);
      expect(result.status).toBe(0);
      expect(result.executed.toSorted()).toEqual(result.expected.toSorted());
    }
  );

  it('a failed harness stops the root test before starting other suites', () => {
    const result = aggregate('test', 'harness');
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.executed).toEqual(['harness']);
  });

  it.each(['test', 'type-check'])('root `%s` preserves a workspace failure', (script) => {
    const result = aggregate(script, 'wallet');
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(result.executed).toContain('wallet');
  });

  it.each(['test', 'type-check'])(
    'more than one package defines `%s`, so the fan-out is load-bearing',
    (script) => {
      const packages = packagesDefining(script);
      expect(packages).toEqual(expect.arrayContaining(['app', 'wallet', 'nostr']));
      expect(packages.length).toBeGreaterThan(1);
    }
  );

  it.each([
    ['ci.yml', 'Test', 'bun run test'],
    ['type-check.yml', 'Type Check', 'bun run type-check'],
  ])('%s runs the %s aggregate at the repo root', (workflow, name, command) => {
    const gate = step(workflow, name as string);
    // The run VALUE, not merely text somewhere in the step.
    expect(gate.run).toBe(command);
    // Any pinning at all re-scopes the aggregate to one package.
    expect(gate.pinnedTo).toBeNull();
  });

  it.each(['wallet', 'nostr'])('%s type-checks its own tests, not just src', (workspace) => {
    // `wallet` shipped with `include: ["src"]` and `rootDir: "src"`, so its
    // 77 test files were never in the program — 20 real errors had
    // accumulated, including a `fundWallet` helper still calling coco v1's
    // `ops.mint.prepare({ mintUrl, method, quoteId })`. Only the live-mint
    // tests reach that helper, so nothing ever executed it either.
    const testFiles = programFiles(workspace).filter((file) =>
      file.includes(`/${workspace}/__tests__/`)
    );
    expect(testFiles.length).toBeGreaterThan(0);
  });

  it('every workspace package is a real directory with a manifest', () => {
    // Keeps `--filter '*'` honest: a workspace entry that resolves to nothing
    // would silently contribute no coverage.
    const missing = rootManifest.workspaces.filter(
      (workspace) => !existsSync(path.join(REPO_ROOT, workspace, 'package.json'))
    );
    expect(missing).toEqual([]);
    expect(readdirSync(WORKFLOWS).length).toBeGreaterThan(0);
  });
});
