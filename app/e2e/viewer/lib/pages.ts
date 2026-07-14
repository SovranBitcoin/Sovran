/** Cross-run index of named captures grouped by canonical page name, backing
 * the viewer's Pages gallery ("every situation of the wallet screen"). Named
 * capture names ARE canonical page names (schema/pages.ts); legacy runs group
 * under whatever free-form names they were recorded with. */
import { CANONICAL_PAGES } from '../../schema/pages';
import { listRuns } from './scan';
import type { PageCapture, PagesIndex, RunDetail } from './types';

const PAGE_ORDER = new Map<string, number>(CANONICAL_PAGES.map((page, index) => [page, index]));

/** Pure grouping over already-scanned run details; `details` must be newest
 * first (listRuns order). Default keeps only the newest complete product run
 * in which each scenario passed, so one flaky rerun never doubles a page. */
export function groupPages(details: RunDetail[], allRuns: boolean): PagesIndex {
  const captures: PageCapture[] = [];
  const seenScenario = new Set<string>();
  for (const detail of details) {
    if (detail.proof !== 'product-run') continue;
    if (!allRuns && detail.status !== 'complete') continue;
    for (const scenario of detail.scenarios) {
      if (!allRuns) {
        if (scenario.ok !== true || seenScenario.has(scenario.scenarioId)) continue;
        seenScenario.add(scenario.scenarioId);
      }
      for (const named of scenario.named) {
        captures.push({
          page: named.name,
          occurrence: named.occurrence,
          file: named.file,
          runId: detail.runId,
          runLabel: detail.label,
          startedAt: detail.startedAt,
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.name,
          stepId: named.stepId,
        });
      }
    }
  }

  const groups = new Map<string, PageCapture[]>();
  for (const capture of captures) {
    const list = groups.get(capture.page) ?? [];
    list.push(capture);
    groups.set(capture.page, list);
  }
  const pages = [...groups.entries()]
    .map(([page, list]) => ({
      page,
      captures: list.sort(
        (a, b) =>
          a.scenarioId.localeCompare(b.scenarioId) ||
          b.startedAt.localeCompare(a.startedAt) ||
          a.occurrence - b.occurrence
      ),
    }))
    .sort((a, b) => {
      const orderA = PAGE_ORDER.get(a.page) ?? CANONICAL_PAGES.length;
      const orderB = PAGE_ORDER.get(b.page) ?? CANONICAL_PAGES.length;
      return orderA - orderB || a.page.localeCompare(b.page);
    });
  return { allRuns, pages };
}

export async function buildPagesIndex(allRuns: boolean): Promise<PagesIndex> {
  return groupPages(await listRuns(), allRuns);
}
