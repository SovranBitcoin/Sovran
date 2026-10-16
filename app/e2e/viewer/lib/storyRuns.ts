/** Adapt recorded story/manual evidence to the viewer's existing timeline contract. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  alive,
  attemptSchema,
  evidenceManifestSchema,
  storyReportSchema,
} from '../../results/runs';
import { safeArtifactPath } from './paths';
import type { RunDetail, ScenarioRunStatus, ScenarioTimeline } from './types';

function directories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}
function json(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function recordedRun(
  runDir: string,
  dirName: string,
  input: unknown
): RunDetail | undefined {
  const parsed = evidenceManifestSchema.safeParse(input);
  if (!parsed.success) return undefined;
  const manifest = parsed.data;
  const live = manifest.state.status === 'running' && alive(manifest.state.pid);
  const status = live
    ? 'in-progress'
    : manifest.state.status === 'running'
      ? 'aborted'
      : 'complete';
  const scenarios: ScenarioTimeline[] = [];
  const scenarioStatus: Record<string, ScenarioRunStatus> = {};
  const selected: string[] = [];
  const served = (file: string) => {
    const rel = relative(runDir, file);
    return safeArtifactPath(runDir, rel) ? rel : undefined;
  };
  if (manifest.kind === 'manual-review') {
    const evidenceDir = join(runDir, 'evidence');
    const files = existsSync(evidenceDir)
      ? readdirSync(evidenceDir)
          .filter((name) => /\.(png|jpg)$/.test(name))
          .sort()
      : [];
    const scenarioId = `review:${manifest.suite}`;
    scenarios.push({
      scenarioId,
      name: manifest.label ?? manifest.suite,
      lane: 'manual',
      description:
        'Manually captured evidence. Original notes and provenance remain with the run; no automated pass is claimed.',
      frames: files.flatMap((name, index) => {
        const file = served(join(evidenceDir, name));
        return file
          ? [
              {
                artifactSeq: index + 1,
                stepId: name,
                phase: 'T' as const,
                kind: 'manual capture',
                label: name,
                file,
              },
            ]
          : [];
      }),
      named: [],
    });
    selected.push(scenarioId);
  } else {
    for (const worker of directories(join(runDir, 'workers'))) {
      for (const kind of ['stories', 'setup'] as const) {
        const parent = join(runDir, 'workers', worker, kind);
        for (const id of directories(parent)) {
          const dir = join(parent, id);
          const scenarioId = kind === 'stories' ? `story:${id}` : `setup:${worker}:${id}`;
          const reportFile = safeArtifactPath(runDir, relative(runDir, join(dir, 'report.json')));
          const report = storyReportSchema.safeParse(reportFile ? json(reportFile) : undefined);
          const attemptFile = safeArtifactPath(runDir, relative(runDir, join(dir, 'attempt.json')));
          const attempt = attemptSchema.safeParse(attemptFile ? json(attemptFile) : undefined);
          const exited = attempt.success && attempt.data.exitCode !== undefined;
          const ok = report.success
            ? report.data.ok && (!exited || attempt.data.exitCode === 0)
            : undefined;
          const timeline: ScenarioTimeline = {
            scenarioId,
            name: report.success ? report.data.id : id,
            lane: kind === 'setup' ? 'setup' : manifest.suite,
            description: report.success
              ? report.data.purpose
              : 'The process left no readable story report.',
            failure:
              (report.success ? report.data.failure : undefined) ??
              (attempt.success ? attempt.data.failure : undefined),
            ok: ok ?? (live && !exited ? undefined : false),
            frames: [],
            named: [],
          };
          if (report.success) {
            const data = report.data;
            timeline.durationMs = data.steps.reduce((sum, step) => sum + step.wallMs, 0);
            timeline.videoFile = data.video ? served(join(dir, data.video)) : undefined;
            timeline.videoEndT = data.videoEndT;
            timeline.frames = data.steps.map((step, index) => ({
              artifactSeq: index + 1,
              stepId: String(index + 1),
              phase: 'T',
              kind: 'story step',
              label: step.name,
              ok: step.ok,
              error: step.failure,
              t: step.endedAtWallMs,
              file: step.picture ? (served(join(dir, step.picture)) ?? '') : '',
              observations: {
                wallMs: step.wallMs,
                screenMovedMs: step.screenMovedMs,
                screenKeptMoving: step.screenKeptMoving,
                appUnresponsiveMs: step.appUnresponsiveMs,
                touchMadeAgain: step.touchMadeAgain,
                warnings: step.entries.filter(
                  (entry) => entry.level === 'warn' || entry.level === 'error'
                ),
              },
            }));
          }
          scenarioStatus[scenarioId] =
            timeline.ok === true ? 'passed' : timeline.ok === false ? 'failed' : 'running';
          scenarios.push(timeline);
          if (kind === 'stories') selected.push(scenarioId);
        }
      }
    }
    for (const id of manifest.selection) {
      const scenarioId = `story:${id}`;
      if (selected.includes(scenarioId)) continue;
      selected.push(scenarioId);
      scenarioStatus[scenarioId] = live ? 'pending' : 'failed';
      scenarios.push({
        scenarioId,
        name: id,
        lane: manifest.suite,
        description: 'No attempt report was recorded.',
        ok: live ? undefined : false,
        frames: [],
        named: [],
      });
    }
  }
  return {
    runId: dirName.slice(4),
    suite: manifest.suite,
    driver: 'sim',
    proof: manifest.kind === 'manual-review' ? 'manual-review' : 'product-run',
    origin: manifest.kind === 'manual-review' ? 'manual' : 'stories',
    startedAt: manifest.startedAt ?? '',
    scenarioIds: selected,
    git: manifest.git,
    // Repository metadata identifies the runner, not the installed native build.
    // Stories do not yet attest source and binary identity as the legacy CLI does.
    commitRun: false,
    label:
      manifest.label ??
      (manifest.startedAt
        ? new Date(manifest.startedAt).toLocaleString()
        : 'Imported story results (date unknown)'),
    status,
    scenarios,
    scenarioStatus,
    fundsSafeToDelete: false,
    ...(manifest.kind === 'stories' && status !== 'in-progress'
      ? {
          result: {
            passed: selected.filter((id) => scenarioStatus[id] === 'passed').length,
            failed: selected.filter((id) => scenarioStatus[id] === 'failed').length,
            skipped: 0,
            deferred: 0,
            durationMs: scenarios
              .filter((item) => selected.includes(item.scenarioId))
              .reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
            funds: 'Not assessed by this report',
          },
        }
      : {}),
  };
}
