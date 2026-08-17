import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  Frame,
  NamedFrame,
  PhaseTag,
  RunStatus,
  RunSummary,
  ScenarioRunStatus,
  ScenarioTimeline,
} from './types';

const STEP_ID_RE = /^(P|T|V|C)\d+$/;
/** NNN-<STEPID>-<kind>.png */
const FRAME_NAME_RE = /^(\d+)-([A-Z0-9]+)-(.+)\.png$/;
/** <name>-NNN.png inside named/ */
const NAMED_NAME_RE = /^(.+)-(\d+)\.png$/;

function phaseOf(stepId: string): PhaseTag | undefined {
  if (stepId === 'FINAL') return 'FINAL';
  const match = STEP_ID_RE.exec(stepId);
  return match ? (match[1] as PhaseTag) : undefined;
}

/** Events record absolute paths from the writing machine; keep only the part
 * inside the run dir so artifacts stay addressable after the repo moves. */
function relativeToRunDir(path: string, runDirName: string): string | undefined {
  const marker = `/${runDirName}/`;
  const at = path.indexOf(marker);
  return at === -1 ? undefined : path.slice(at + marker.length);
}

interface ParsedEvents {
  scenarios: ScenarioTimeline[];
  runEnd?: {
    passed: number;
    failed: number;
    skipped: number;
    deferred: number;
    durationMs: number;
    funds: string;
  };
}

export function parseEvents(eventsText: string, runDirName: string): ParsedEvents {
  const timelines = new Map<string, ScenarioTimeline>();
  let current: ScenarioTimeline | undefined;
  let runEnd: ParsedEvents['runEnd'];
  const steps = new Map<string, { kind: string; label?: string; ok?: boolean; error?: string }>();
  let openStepId: string | undefined;
  const namedCounts = new Map<string, number>();
  // Screenshot and ax artifacts arrive as separate events; pair them by
  // (stepId, artifactSeq) for step frames and by named basename for named ones.
  const framesByKey = new Map<string, Frame>();
  const namedByBase = new Map<string, NamedFrame>();
  // store/db sidecar events can carry a PREVIOUS frame's path (unchanged-state
  // dedup), so they pair strictly by (stepId, artifactSeq) — named frames need
  // their own seq-keyed index since namedByBase keys by png basename.
  const namedByKey = new Map<string, NamedFrame>();

  for (const line of eventsText.split('\n')) {
    if (!line.trim()) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // tolerate the truncated tail of an in-progress run
    }
    switch (event.type) {
      case 'scenario.begin': {
        current = {
          scenarioId: String(event.id),
          name: String(event.name ?? event.id),
          lane: String(event.lane ?? ''),
          frames: [],
          named: [],
        };
        timelines.set(current.scenarioId, current);
        steps.clear();
        namedCounts.clear();
        framesByKey.clear();
        namedByBase.clear();
        namedByKey.clear();
        break;
      }
      case 'scenario.end': {
        if (current && event.id === current.scenarioId) {
          current.ok = Boolean(event.ok);
          if (typeof event.durationMs === 'number') current.durationMs = event.durationMs;
          current = undefined;
        }
        break;
      }
      case 'deferred': {
        if (current) current.deferred = true;
        break;
      }
      case 'step.begin': {
        const stepId = String(event.stepId);
        openStepId = stepId;
        steps.set(stepId, {
          kind: String(event.kind ?? ''),
          label: typeof event.label === 'string' ? event.label : undefined,
        });
        break;
      }
      case 'step.end': {
        const stepId = String(event.stepId);
        const step = steps.get(stepId);
        if (step) {
          step.ok = Boolean(event.ok);
          if (typeof event.error === 'string') step.error = event.error;
        }
        if (openStepId === stepId) openStepId = undefined;
        // Frames were captured while the step was open, before its outcome
        // existed; back-fill so failed steps render red in the player.
        for (const frame of framesByKey.values()) {
          if (frame.stepId === stepId) {
            frame.ok = step?.ok;
            frame.error = step?.error;
          }
        }
        break;
      }
      case 'artifact': {
        if (!current) break;
        const kind = String(event.kind);
        if (kind === 'video') {
          const videoRel = relativeToRunDir(String(event.path), runDirName);
          if (videoRel) {
            current.videoFile = videoRel;
            if (typeof event.t === 'number') current.videoEndT = event.t;
          }
          break;
        }
        if (kind === 'store' || kind === 'db') {
          const rel = relativeToRunDir(String(event.path), runDirName);
          if (!rel) break;
          const key = `${event.stepId}:${event.artifactSeq}`;
          const target = framesByKey.get(key) ?? namedByKey.get(key);
          if (target) {
            if (kind === 'store') target.storeFile = rel;
            else target.dbFile = rel;
          }
          break;
        }
        if (kind !== 'screenshot' && kind !== 'ax') break;
        const rel = relativeToRunDir(String(event.path), runDirName);
        if (!rel) break;
        const base = rel.split('/').pop() ?? '';
        const isNamed = rel.includes('/named/');
        if (isNamed) {
          const nameBase = base.replace(/\.ax\.json$/, '.png');
          if (kind === 'ax') {
            const named = namedByBase.get(nameBase);
            if (named) named.axFile = rel;
            break;
          }
          const match = NAMED_NAME_RE.exec(base);
          const name = match ? match[1] : base.replace(/\.png$/, '');
          const occurrence = (namedCounts.get(name) ?? 0) + 1;
          namedCounts.set(name, occurrence);
          const named: NamedFrame = {
            name,
            occurrence,
            file: rel,
            stepId: openStepId,
            artifactSeq: Number(event.artifactSeq ?? (match ? match[2] : 0)),
            phase: openStepId ? phaseOf(openStepId) : undefined,
            t: typeof event.t === 'number' ? event.t : undefined,
          };
          namedByBase.set(nameBase, named);
          namedByKey.set(`${event.stepId}:${event.artifactSeq}`, named);
          current.named.push(named);
          break;
        }
        const frameKey = `${event.stepId}:${event.artifactSeq}`;
        if (kind === 'ax') {
          const frame = framesByKey.get(frameKey);
          if (frame) frame.axFile = rel;
          break;
        }
        const stepId = String(event.stepId);
        const phase = phaseOf(stepId);
        if (!phase) break;
        const step = steps.get(stepId);
        const nameMatch = FRAME_NAME_RE.exec(base);
        const frame: Frame = {
          artifactSeq: Number(event.artifactSeq ?? 0),
          stepId,
          phase,
          kind: nameMatch ? nameMatch[3] : (step?.kind ?? ''),
          label: step?.label,
          ok: step?.ok,
          error: step?.error,
          t: typeof event.t === 'number' ? event.t : undefined,
          file: rel,
        };
        framesByKey.set(frameKey, frame);
        current.frames.push(frame);
        break;
      }
      case 'final-state': {
        if (current) {
          current.finalState = {
            expected: String(event.expected ?? ''),
            actual: String(event.actual ?? ''),
            ok: Boolean(event.ok),
          };
        }
        break;
      }
      case 'run.end': {
        runEnd = {
          passed: Number(event.passed ?? 0),
          failed: Number(event.failed ?? 0),
          skipped: Number(event.skipped ?? 0),
          deferred: Number(event.deferred ?? 0),
          durationMs: Number(event.durationMs ?? 0),
          funds: String(event.funds ?? 'n/a'),
        };
        break;
      }
      default:
        break;
    }
  }

  for (const timeline of timelines.values()) {
    timeline.frames.sort((a, b) => a.artifactSeq - b.artifactSeq);
  }
  return { scenarios: [...timelines.values()], runEnd };
}

/** Map each manifest scenario to its live status. Runs execute sequentially,
 * so at most one timeline is begun-but-unended; that one is the active
 * scenario while the run is in-progress (and a mid-scenario abort once it
 * isn't). Scenarios with no timeline yet are pending on a live run and
 * skipped (fail-fast / never reached) on a finished one. */
export function deriveScenarioStatuses(
  scenarioIds: string[],
  timelines: ScenarioTimeline[],
  runStatus: RunStatus
): { scenarioStatus: Record<string, ScenarioRunStatus>; activeScenarioId?: string } {
  const byId = new Map(timelines.map((timeline) => [timeline.scenarioId, timeline]));
  const live = runStatus === 'in-progress';
  const scenarioStatus: Record<string, ScenarioRunStatus> = {};
  let activeScenarioId: string | undefined;
  for (const scenarioId of scenarioIds) {
    const timeline = byId.get(scenarioId);
    if (!timeline) {
      scenarioStatus[scenarioId] = live ? 'pending' : 'skipped';
      continue;
    }
    if (timeline.deferred) {
      scenarioStatus[scenarioId] = 'deferred';
      continue;
    }
    if (timeline.ok !== undefined) {
      scenarioStatus[scenarioId] = timeline.ok ? 'passed' : 'failed';
      continue;
    }
    scenarioStatus[scenarioId] = live ? 'running' : 'failed';
    if (live) activeScenarioId = scenarioId;
  }
  return { scenarioStatus, activeScenarioId };
}

/** Crash-early fallback when events.jsonl is missing or unreadable: rebuild a
 * bare timeline from the screenshot filenames alone. */
export function timelinesFromDirScan(runDir: string, scenarioIds: string[]): ScenarioTimeline[] {
  const timelines: ScenarioTimeline[] = [];
  for (const scenarioId of scenarioIds) {
    const timeline: ScenarioTimeline = {
      scenarioId,
      name: scenarioId,
      lane: '',
      frames: [],
      named: [],
    };
    let entries: string[] = [];
    try {
      entries = readdirSync(join(runDir, scenarioId));
    } catch {
      timelines.push(timeline);
      continue;
    }
    for (const entry of entries.sort()) {
      if (entry === 'video.mp4') {
        timeline.videoFile = `${scenarioId}/${entry}`;
        continue;
      }
      const match = FRAME_NAME_RE.exec(entry);
      if (!match) continue;
      const phase = phaseOf(match[2]);
      if (!phase) continue;
      timeline.frames.push({
        artifactSeq: Number(match[1]),
        stepId: match[2],
        phase,
        kind: match[3],
        file: `${scenarioId}/${entry}`,
        axFile: `${scenarioId}/${entry.replace(/\.png$/, '.ax.json')}`,
      });
    }
    try {
      for (const entry of readdirSync(join(runDir, scenarioId, 'named')).sort()) {
        const match = NAMED_NAME_RE.exec(entry);
        if (!match) continue;
        timeline.named.push({
          name: match[1],
          occurrence: 1,
          file: `${scenarioId}/named/${entry}`,
          artifactSeq: Number(match[2]),
        });
      }
    } catch {
      // no named captures
    }
    timelines.push(timeline);
  }
  return timelines;
}

export function runLabel(summary: Pick<RunSummary, 'git' | 'startedAt'>): string {
  if (summary.git && !summary.git.dirty) return `#${summary.git.shortSha}`;
  const date = new Date(summary.startedAt);
  if (Number.isNaN(date.getTime())) return summary.startedAt;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
