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

/** The authoring tree and suite files don't change mid-run, but the live poll
 * rebuilds the catalog every ~2s — memoize both loads briefly so polling stays
 * ~free while plain browsing keeps near-immediate authoring freshness. */
const AUTHORING_CACHE_TTL_MS = 10_000;
let scenarioFilesCache: { at: number; files: ScenarioFile[] } | undefined;
let membershipCache: { at: number; membership: Map<string, string[]> } | undefined;

export function invalidateAuthoringCache(): void {
  scenarioFilesCache = undefined;
  membershipCache = undefined;
}

async function loadScenarioFiles(): Promise<ScenarioFile[]> {
  if (scenarioFilesCache && Date.now() - scenarioFilesCache.at < AUTHORING_CACHE_TTL_MS) {
    return scenarioFilesCache.files;
  }
  const files = await loadScenarioFilesUncached();
  scenarioFilesCache = { at: Date.now(), files };
  return files;
}

async function loadScenarioFilesUncached(): Promise<ScenarioFile[]> {
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
  if (membershipCache && Date.now() - membershipCache.at < AUTHORING_CACHE_TTL_MS) {
    return membershipCache.membership;
  }
  const membership = await loadSuiteMembershipUncached();
  membershipCache = { at: Date.now(), membership };
  return membership;
}

async function loadSuiteMembershipUncached(): Promise<Map<string, string[]>> {
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
 * attempted scenario run and may appear under that scenario in the viewer —
 * except while the run is live, when its pending/running members surface too
 * so the tree can show what's queued and what's executing. Those refs vanish
 * on the refresh after run.end (they become skipped and are excluded again). */
export function catalogRunRef(detail: RunDetail, scenarioId: string): CatalogRunRef | undefined {
  const timeline = detail.scenarios.find((scenario) => scenario.scenarioId === scenarioId);
  const scenarioStatus = detail.scenarioStatus?.[scenarioId];
  if (!timeline || timeline.deferred) {
    const liveUnbegun =
      detail.status === 'in-progress' &&
      (scenarioStatus === 'pending' || scenarioStatus === 'running');
    if (!liveUnbegun) return undefined;
  }
  const ref: CatalogRunRef = {
    runId: `run-${detail.runId}`,
    label: detail.label,
    commitRun: detail.commitRun,
    startedAt: detail.startedAt,
    status: detail.status,
    proof: detail.proof,
    driver: detail.driver,
    ok: timeline?.ok,
  };
  if (scenarioStatus) ref.scenarioStatus = scenarioStatus;
  return ref;
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
