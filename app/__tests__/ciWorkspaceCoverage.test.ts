/**
 * @jest-environment node
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
 * The fix is one canonical aggregate — the root scripts fan out with
 * `bun run --filter '*'` — used by both CI and humans. These tests fail if the
 * aggregate is narrowed back to a single package, or if a gate re-pins itself
 * to `app/`. The `--filter '*'` form is asserted specifically because naming
 * packages explicitly is what rots when a fifth workspace is added.
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

describe('CI covers every workspace package', () => {
  it.each(['test', 'type-check'])(
    'root `%s` fans out over the workspace rather than delegating to one package',
    (script) => {
      const command = rootManifest.scripts[script];
      expect(command).toBe(`bun run --filter '*' ${script}`);
      // The delegate form is exactly the regression this guards.
      expect(command).not.toContain('cd app');
    }
  );

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
