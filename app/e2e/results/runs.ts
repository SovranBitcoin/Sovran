/** On-disk ownership of story evidence. Each invocation owns a fresh run;
 * workers own separate attempt directories and never replace earlier results. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { captureGitInfo } from '../core/git';

const segment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const git = z.object({
  sha: z.string(),
  shortSha: z.string(),
  branch: z.string(),
  dirty: z.boolean(),
});
export const evidenceManifestSchema = z.object({
  version: z.literal(1),
  kind: z.enum(['stories', 'manual-review']),
  suite: z.string(),
  label: z.string().optional(),
  startedAt: z.string().optional(),
  importedAt: z.string().optional(),
  git: git.optional(),
  selection: z.array(segment),
  state: z.discriminatedUnion('status', [
    z.object({ status: z.literal('running'), pid: z.number().int().positive() }),
    z.object({ status: z.literal('complete'), endedAt: z.string() }),
    z.object({ status: z.literal('imported') }),
  ]),
});
type EvidenceManifest = z.infer<typeof evidenceManifestSchema>;
export const attemptSchema = z.object({
  id: segment,
  exitCode: z.number().int().optional(),
  failure: z.string().optional(),
});
export const storyReportSchema = z.object({
  id: z.string(),
  purpose: z.string(),
  startsFrom: z.string(),
  ok: z.boolean(),
  failure: z.string().optional(),
  video: z.string().optional(),
  videoEndT: z.number().optional(),
  spentMs: z.record(z.string(), z.number()).optional(),
  steps: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      wallMs: z.number(),
      picture: z.string().optional(),
      failure: z.string().optional(),
      endedAtWallMs: z.number().optional(),
      screenMovedMs: z.number().optional(),
      screenKeptMoving: z.boolean().optional(),
      appUnresponsiveMs: z.number().optional(),
      touchMadeAgain: z.boolean().optional(),
      entries: z.array(z.object({ level: z.string(), event: z.string() })).default([]),
    })
  ),
});

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export function writeManifest(dir: string, manifest: EvidenceManifest): void {
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(evidenceManifestSchema.parse(manifest), null, 2)}\n`
  );
}
export function createStoryRun(root: string, suite: string, selection: string[]): string {
  const dir = join(
    root,
    `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  );
  mkdirSync(dir, { recursive: true });
  writeManifest(dir, {
    version: 1,
    kind: 'stories',
    suite,
    startedAt: new Date().toISOString(),
    git: captureGitInfo(process.cwd()),
    selection,
    state: { status: 'running', pid: process.pid },
  });
  return dir;
}
export function finishStoryRun(dir: string): void {
  const manifest = evidenceManifestSchema.parse(
    JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  );
  writeManifest(dir, {
    ...manifest,
    state: { status: 'complete', endedAt: new Date().toISOString() },
  });
}
export function attemptDirectory(
  run: string,
  worker: string,
  id: string,
  kind: 'stories' | 'setup' = 'stories'
): string {
  return join(run, 'workers', segment.parse(worker), kind, segment.parse(id));
}
export function registerAttempt(run: string, worker: string, id: string): string {
  const dir = attemptDirectory(run, worker, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'attempt.json'), JSON.stringify(attemptSchema.parse({ id })), {
    flag: 'wx',
  });
  return dir;
}
export function finishAttempt(dir: string, id: string, exitCode: number, failure?: string): void {
  writeFileSync(
    join(dir, 'attempt.json'),
    JSON.stringify(attemptSchema.parse({ id, exitCode, failure }))
  );
}

/** A saved story may already have spent against a non-rewindable public mint.
 * Missing evidence is not permission to restore its input and replay it. */
export function reusableEvidence(
  hasSavedState: boolean,
  evidence: string | undefined
): string | undefined {
  if (hasSavedState && !evidence)
    throw new Error(
      'This simulator has already played the story, but its matching evidence is unavailable in this run. Use a new disposable simulator rather than replaying a saved wallet.'
    );
  return hasSavedState ? evidence : undefined;
}
