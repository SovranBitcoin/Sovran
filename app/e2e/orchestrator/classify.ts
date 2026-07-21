/**
 * Post-hoc classification of one child CLI run directory into an attempt
 * outcome plus the failure evidence an agent needs to fix the scenario
 * (failing step, error, screenshot/AX/metro paths). Reads only durable
 * artifacts — events.jsonl (truncation-tolerant via the viewer's parser) and
 * the directory listing — so it works identically for live attempts, killed
 * attempts, and resume-time reconciliation.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseEvents } from '../viewer/lib/timeline';
import type { ScenarioTimeline } from '../viewer/lib/types';
import type { AttemptOutcome, AttemptRecord } from './state';

export interface AttemptClassification {
  outcome: AttemptOutcome;
  failure?: NonNullable<AttemptRecord['failure']>;
  artifacts?: NonNullable<AttemptRecord['artifacts']>;
}

/** Paths in records/SUMMARY are relative to app/ so every printed path is
 * directly openable from the CLI's working directory. */
const runDirRel = (runDirName: string): string => `e2e/artifacts/${runDirName}`;

export function classifyRunDir(
  artifactsRoot: string,
  runDirName: string | undefined,
  options: { interrupted?: boolean } = {}
): AttemptClassification {
  if (!runDirName) {
    return { outcome: options.interrupted ? 'interrupted' : 'preflight-failed' };
  }
  const runDir = join(artifactsRoot, runDirName);
  const artifacts = {
    runDir: runDirRel(runDirName),
    events: `${runDirRel(runDirName)}/events.jsonl`,
    metroLogs: listMetroLogs(runDir).map((rel) => `${runDirRel(runDirName)}/${rel}`),
  };

  let eventsText: string;
  try {
    eventsText = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
  } catch {
    return { outcome: options.interrupted ? 'interrupted' : 'infra-aborted', artifacts };
  }
  const parsed = parseEvents(eventsText, runDirName);
  const failedTimeline = parsed.scenarios.find((timeline) => timeline.ok === false);
  const failure = failedTimeline ? failureFromTimeline(runDirName, failedTimeline) : undefined;

  if (parsed.runEnd) {
    if (parsed.runEnd.funds === 'quarantined') {
      return { outcome: 'funded-quarantined', failure, artifacts };
    }
    if (parsed.runEnd.failed === 0 && parsed.runEnd.skipped === 0) {
      return { outcome: 'passed', artifacts };
    }
    return { outcome: 'scenario-failed', failure, artifacts };
  }
  if (options.interrupted) return { outcome: 'interrupted', failure, artifacts };
  // A red scenario.end without run.end means the failure itself is known even
  // though the process died before summarizing — charge the scenario budget.
  if (failedTimeline) return { outcome: 'scenario-failed', failure, artifacts };
  return { outcome: 'infra-aborted', artifacts };
}

function failureFromTimeline(
  runDirName: string,
  timeline: ScenarioTimeline
): NonNullable<AttemptRecord['failure']> {
  const redFrame = timeline.frames.find((frame) => frame.ok === false);
  return {
    scenarioId: timeline.scenarioId,
    stepId: redFrame?.stepId,
    error: redFrame?.error,
    screenshot: redFrame ? `${runDirRel(runDirName)}/${redFrame.file}` : undefined,
    axFile: redFrame?.axFile ? `${runDirRel(runDirName)}/${redFrame.axFile}` : undefined,
  };
}

function listMetroLogs(runDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(runDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^session-\d+$/.test(name))
    .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)))
    .filter((name) => existsSync(join(runDir, name, 'metro.log')))
    .map((name) => `${name}/metro.log`);
}
