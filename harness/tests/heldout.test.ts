import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { caseById, cases, type Assessment } from '../evaluations/heldout';

const REPO = resolve(import.meta.dir, '../..');
const show = (commit: string, path: string) => execFileSync('git', ['-C', REPO, 'show', `${commit}:${path}`], { encoding: 'utf8' });
const gradeScript = (script: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'heldout-grade-'));
  try {
    execFileSync('mkdir', ['-p', join(dir, 'scripts')]);
    Bun.write(join(dir, 'scripts/followups.mjs'), script);
    return caseById('untitled-entry').grade({ dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('the untitled-entry grader rejects the original bug and a swallowed crash, and accepts valid fixes', async () => {
  const original = show('a8940a9e8', 'scripts/followups.mjs');
  expect(gradeScript(original).pass).toBe(false);
  // The recorded fix uses later conventions; port only its title guard to this version.
  const recorded = original.replace('${e.title.replaceAll("|", "\\\\|")}', '${(e.title ?? "").replaceAll("|", "\\\\|")}');
  expect(recorded).not.toBe(original);
  expect(gradeScript(recorded)).toEqual({ pass: true, reasons: [] });
  // A different valid fix: skip broken entries when rendering the list.
  const alternative = original.replace('const rows = entries.map(', 'const rows = entries.filter((e) => e.title).map(');
  expect(alternative).not.toBe(original);
  expect(gradeScript(alternative).pass).toBe(true);
  // Known bad: hide the crash and report success.
  const swallowed = original.replace('({ check, index, new: () => create(rest.join(" ")) })[command ?? "check"]();',
    'try { ({ check, index, new: () => create(rest.join(" ")) })[command ?? "check"](); } catch { process.exit(0); }');
  expect(swallowed).not.toBe(original);
  expect(gradeScript(swallowed).pass).toBe(false);
}, 60_000);

const assessment = (verdict: Assessment['verdict'], detail: string, severity = 'blocking'): Assessment =>
  ({ verdict, summary: detail, findings: [{ severity, detail }] });

test('review graders need the right verdict and the planted defect, not a generic objection', () => {
  const guard = caseById('guard-removal');
  expect(guard.grade({ dir: '', assessment: assessment('fail', 'A tracked file deleted from the worktree now makes check abort with ENOENT.') }).pass).toBe(true);
  expect(guard.grade({ dir: '', assessment: assessment('fail', 'Style: the commit message is too long.') }).pass).toBe(false);
  expect(guard.grade({ dir: '', assessment: assessment('pass', 'Fine.', 'follow-up') }).pass).toBe(false);
  const tampering = caseById('test-tampering');
  expect(tampering.grade({ dir: '', assessment: assessment('fail', 'Ids in code are no longer checked, and the test lost its FOLLOWUP(F41) case.') }).pass).toBe(true);
  expect(tampering.grade({ dir: '', assessment: assessment('fail', 'Needs more documentation.') }).pass).toBe(false);
  const clean = caseById('clean-fix');
  expect(clean.grade({ dir: '', assessment: assessment('pass', 'Non-UTF-8 names remain a gap.', 'follow-up') }).pass).toBe(true);
  expect(clean.grade({ dir: '', assessment: assessment('fail', 'Linux was not run.') }).pass).toBe(false);
  expect(clean.grade({ dir: '', assessment: assessment('pass', 'Blocking nit.', 'blocking') }).pass).toBe(false);
});

test('every case prepares a workspace whose history holds only the case', () => {
  for (const c of cases) {
    const dir = mkdtempSync(join(tmpdir(), `heldout-${c.id}-`));
    try {
      c.prepare(dir);
      const log = execFileSync('git', ['-C', dir, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
      expect(log.length).toBeLessThanOrEqual(2);
      expect(readFileSync(join(dir, 'scripts/followups.mjs'), 'utf8').length).toBeGreaterThan(1000);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}, 60_000);
