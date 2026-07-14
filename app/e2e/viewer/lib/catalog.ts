import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { parseFacets, type ScenarioFacets } from '../../schema/facets';
import { SCENARIOS, SUITES } from './paths';
import { listRuns } from './scan';
import type { CatalogRunRef, RunDetail, ScenarioCatalogEntry } from './types';

interface ScenarioFile {
  id: string;
  name: string;
  description: string;
  lane: string;
  tags: string[];
  facets: ScenarioFacets;
  deferredReason?: string;
}

async function loadScenarioFiles(): Promise<ScenarioFile[]> {
  const files: ScenarioFile[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(SCENARIOS).filter((name) => name.endsWith('.json'));
  } catch {
    return files;
  }
  for (const entry of entries) {
    try {
      const raw = JSON.parse(await Bun.file(join(SCENARIOS, entry)).text());
      if (typeof raw.id !== 'string') continue;
      const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];
      files.push({
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : raw.id,
        description: typeof raw.description === 'string' ? raw.description : '',
        lane: typeof raw.lane === 'string' ? raw.lane : '',
        tags,
        facets: parseFacets(tags),
        deferredReason: typeof raw.deferredReason === 'string' ? raw.deferredReason : undefined,
      });
    } catch {
      // skip unparseable scenario files; e2e:validate owns authoring errors
    }
  }
  return files.sort((a, b) => a.id.localeCompare(b.id));
}

async function loadSuiteMembership(): Promise<Map<string, string[]>> {
  const membership = new Map<string, string[]>();
  let entries: string[] = [];
  try {
    entries = readdirSync(SUITES).filter((name) => name.endsWith('.json'));
  } catch {
    return membership;
  }
  for (const entry of entries) {
    const suiteName = entry.replace(/\.json$/, '');
    try {
      const raw = JSON.parse(await Bun.file(join(SUITES, entry)).text());
      const refs: unknown[] = Array.isArray(raw.scenarios) ? raw.scenarios : [];
      for (const ref of refs) {
        const id = (ref as Record<string, unknown>)?.id;
        if (typeof id !== 'string') continue;
        membership.set(id, [...(membership.get(id) ?? []), suiteName]);
      }
    } catch {
      // skip unparseable suites
    }
  }
  return membership;
}

function runRef(detail: RunDetail, scenarioId: string): CatalogRunRef {
  const timeline = detail.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  return {
    runId: `run-${detail.runId}`,
    label: detail.label,
    commitRun: detail.commitRun,
    startedAt: detail.startedAt,
    status: detail.status,
    proof: detail.proof,
    ok: timeline?.ok,
  };
}

export async function buildCatalog(): Promise<ScenarioCatalogEntry[]> {
  const [files, membership, runs] = await Promise.all([
    loadScenarioFiles(),
    loadSuiteMembership(),
    listRuns(),
  ]);
  return files.map((file) => ({
    ...file,
    suites: membership.get(file.id) ?? [],
    runs: runs
      .filter((run) => run.scenarioIds.includes(file.id))
      .map((run) => runRef(run, file.id)),
  }));
}
