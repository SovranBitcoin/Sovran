/**
 * Git + GitHub (gh) helpers.
 *
 * Pure predicates (parsePorcelain, isDirty, classifyForkSync) are separated from
 * the command-running IO so the preflight gates can be unit-tested.
 */

import { execFileSync } from 'child_process';

// ─── Pure predicates ─────────────────────────────────────────────────────────

/** Parse `git status --porcelain` output into {status, file} entries. Pure. */
export function parsePorcelain(output) {
  return output
    .split('\n')
    .filter((l) => l.trim().length)
    .map((l) => ({ status: l.slice(0, 2).trim(), file: l.slice(3) }));
}

/** True if the working tree has any changes. Pure. */
export function isDirty(output) {
  return parsePorcelain(output).length > 0;
}

/**
 * Classify how the fork's main relates to upstream/main. Pure.
 * @returns {{action:'up-to-date'|'fast-forward'|'diverged'}}
 */
export function classifyForkSync({ localSha, upstreamSha, mergeBaseSha }) {
  if (localSha === upstreamSha) return { action: 'up-to-date' };
  if (mergeBaseSha === localSha) return { action: 'fast-forward' };
  return { action: 'diverged' };
}

// ─── Command IO ──────────────────────────────────────────────────────────────

/** Run a git command in `cwd` and return trimmed stdout. */
export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}

/** Run a gh command and return trimmed stdout. */
export function gh(args, cwd) {
  return execFileSync('gh', args, { cwd, encoding: 'utf-8' }).trim();
}

export function statusPorcelain(cwd) {
  return git(['status', '--porcelain'], cwd);
}

export function revParse(ref, cwd) {
  return git(['rev-parse', ref], cwd);
}

export function mergeBase(a, b, cwd) {
  return git(['merge-base', a, b], cwd);
}

export function fetch(remote, ref, cwd) {
  git(['fetch', remote, ref, '--quiet'], cwd);
}

export function ghAuthOk() {
  try {
    execFileSync('gh', ['auth', 'status', '-h', 'github.com'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function ghLogin() {
  return gh(['api', 'user', '--jq', '.login']);
}

/** Open PR url for a head ref against a target repo, or '' if none. */
export function openPrUrl({ repo, head, base }) {
  const out = gh(
    [
      'pr',
      'list',
      '-R',
      repo,
      '--head',
      head,
      '--base',
      base,
      '--state',
      'open',
      '--json',
      'url',
      '--jq',
      '.[0].url',
    ],
    undefined
  );
  return out && out !== 'null' ? out : '';
}

export function createPr({ repo, base, head, title, body }) {
  return gh([
    'pr',
    'create',
    '-R',
    repo,
    '--base',
    base,
    '--head',
    head,
    '--title',
    title,
    '--body',
    body,
  ]);
}

export function editPrBody({ repo, prUrl, body }) {
  gh(['pr', 'edit', prUrl, '-R', repo, '--body', body]);
}

/** Status of the named check on a PR: 'pass' | 'fail' | 'pending' | ''. */
export function prCheckState({ repo, prUrl, name }) {
  const out = gh(['pr', 'checks', prUrl, '-R', repo]);
  const row = out.split('\n').find((l) => l.includes(name));
  return row ? row.split('\t')[1] : '';
}

export function squashMerge({ repo, prUrl }) {
  // Plain squash merge — the caller has already confirmed CI passed, so we don't
  // depend on the repo having GitHub's auto-merge feature enabled.
  gh(['pr', 'merge', prUrl, '-R', repo, '--squash']);
}
