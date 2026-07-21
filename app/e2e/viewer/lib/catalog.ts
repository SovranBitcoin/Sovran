import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadE2E } from '../../core/loader';
import { effectiveRequirements } from '../../core/plan';
import type { Fixture, Scenario } from '../../schema';
import { scenarioPlatforms, type Platform } from '../../schema/capabilities';
import { parseFacets, type ScenarioFacets } from '../../schema/facets';
import { E2E_ROOT, SUITES } from './paths';
import { listRuns } from './scan';
import type { CatalogRunRef, RunDetail, ScenarioCatalogEntry } from './types';

interface ScenarioFile {
  id: string;
  name: string;
  description: string;
  details?: string;
  lane: string;
  tags: string[];
  facets: ScenarioFacets;
  platforms: Platform[];
  deferredReason?: string;
}

/** Keep viewer platform chips and rerun planning on the same fixture-expanded
 * capability contract as CLI plan expansion. A platform-specific requirement
 * may live in a nested setup/finally fixture, not only on the scenario itself. */
export function catalogScenarioPlatforms(
  scenario: Scenario,
  fixtures: Map<string, Fixture>
): Platform[] {
  return scenarioPlatforms(effectiveRequirements(scenario, fixtures));
}

async function loadScenarioFiles(): Promise<ScenarioFile[]> {
  try {
    const loaded = loadE2E(E2E_ROOT);
    return [...loaded.scenarios.values()]
      .map((scenario) => ({
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        details: scenario.details,
        lane: scenario.lane,
        tags: scenario.tags,
        facets: parseFacets(scenario.tags),
        platforms: catalogScenarioPlatforms(scenario, loaded.fixtures),
        deferredReason: scenario.deferredReason,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    // The viewer remains usable for historical runs if the authoring tree is
    // temporarily unavailable; e2e:validate owns authoring diagnostics.
    return [];
  }
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

/** A manifest records the whole selection, including capability deferrals and
 * scenarios skipped after fail-fast. Only a real, non-deferred timeline is an
 * attempted scenario run and may appear under that scenario in the viewer. */
export function catalogRunRef(detail: RunDetail, scenarioId: string): CatalogRunRef | undefined {
  const timeline = detail.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  if (!timeline || timeline.deferred) return undefined;
  return {
    runId: `run-${detail.runId}`,
    label: detail.label,
    commitRun: detail.commitRun,
    startedAt: detail.startedAt,
    status: detail.status,
    proof: detail.proof,
    driver: detail.driver,
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
      .map((run) => catalogRunRef(run, file.id))
      .filter((run): run is CatalogRunRef => run !== undefined),
  }));
}
