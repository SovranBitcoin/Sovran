import { selectScenario } from '../actions';
import { facetTagLabel, flowGroupLabel, PLATFORM_LABELS } from '../facetLabels';
import { persistCollapsedFlows, state, update } from '../state';
import { FACETS } from '../../../schema/facets';
import type { CatalogRunRef, ScenarioCatalogEntry } from '../../lib/types';

function okGlyph(ok: boolean | undefined, status: CatalogRunRef['status']): string {
  if (status === 'in-progress') return '<span class="glyph-live">●</span>';
  if (status === 'aborted') return '<span class="glyph-fail">◌</span>';
  if (ok === undefined) return '';
  return ok ? '<span class="glyph-pass">✓</span>' : '<span class="glyph-fail">✗</span>';
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function latestRun(entry: ScenarioCatalogEntry): CatalogRunRef | undefined {
  return entry.runs.find((run) => run.proof === 'product-run');
}

/** "iPhone" / "Android" chips: a scenario shows every platform it is specified
 * to work on; a run row shows the one platform that run actually used. */
function platformChips(platforms: readonly ('ios' | 'android')[]): string {
  return platforms
    .map(
      (platform) =>
        `<span class="platform-chip platform-${platform}">${PLATFORM_LABELS[platform]}</span>`
    )
    .join('');
}

function runPlatformChip(run: CatalogRunRef): string {
  if (run.driver === 'sim') return platformChips(['ios']);
  if (run.driver === 'android') return platformChips(['android']);
  return '';
}

/** Collapsible flow-facet tree: caret group headers (sticky while their group
 * scrolls) → scenario rows → run versions under the selected scenario.
 * Collapse state lives in state.collapsedFlows and survives reloads; a
 * collapsed group keeps failures visible via a red count on its header. */
export function renderRunList(root: HTMLElement): void {
  const parts: string[] = ['<div class="panel-title">Scenarios</div>'];
  const byFlow = (flow: string | undefined) =>
    state.catalog.filter((entry) => entry.facets?.flow === flow);
  const grouped: [string, ScenarioCatalogEntry[]][] = [
    ...FACETS.flow.map((flow): [string, ScenarioCatalogEntry[]] => [flow, byFlow(flow)]),
    ['untagged', byFlow(undefined)],
  ];
  for (const [flow, entries] of grouped) {
    if (entries.length === 0) continue;
    const collapsed = state.collapsedFlows.includes(flow);
    const failing = entries.filter((entry) => latestRun(entry)?.ok === false).length;
    parts.push(
      `<button class="tree-group" data-flow="${escapeHtml(flow)}" aria-expanded="${!collapsed}">` +
        `<span class="caret${collapsed ? '' : ' open'}">▸</span>` +
        `<span class="flow-name">${escapeHtml(flowGroupLabel(flow))}</span>` +
        (failing ? `<span class="fail-count">${failing} ✗</span>` : '') +
        `<span class="badge">${entries.length}</span>` +
        `</button>`
    );
    if (!collapsed) {
      parts.push('<div class="tree-children">', ...entries.map(renderScenarioRows), '</div>');
    }
  }
  if (state.catalog.length === 0) {
    parts.push('<div class="scenario-row">no scenarios found</div>');
  } else if (
    !state.catalog.some((entry) => entry.runs.some((run) => run.proof === 'product-run'))
  ) {
    parts.push('<div class="scenario-row">no runs yet — trigger one above</div>');
  }
  root.innerHTML = parts.join('');
  bindRows(root);

  function renderScenarioRows(entry: ScenarioCatalogEntry): string {
    const rows: string[] = [];
    const runs = entry.runs.filter((run) => run.proof === 'product-run');
    const selected = state.selectedScenarioId === entry.id && state.mode === 'browse';
    const latest = runs[0];
    const tooltip = [entry.description, entry.tags.map(facetTagLabel).join(' · ')]
      .filter(Boolean)
      .join('\n');
    rows.push(
      `<div class="run-row${selected ? ' selected' : ''}${runs.length === 0 ? ' smoke' : ''}" data-scenario="${escapeHtml(entry.id)}" title="${escapeHtml(tooltip)}">` +
        `${latest ? okGlyph(latest.ok, latest.status) : ''}<span class="title">${escapeHtml(entry.name)}</span>` +
        platformChips(entry.platforms) +
        `<span class="badge">${runs.length || ''}</span>` +
        `</div>`
    );
    if (selected) {
      rows.push('<div class="run-scenarios">');
      for (const run of runs) {
        const runSelected = state.selectedRunId === run.runId;
        rows.push(
          `<div class="scenario-row${runSelected ? ' selected' : ''}" data-run="${run.runId}" data-scenario="${escapeHtml(entry.id)}">` +
            `${okGlyph(run.ok, run.status)}<span class="${run.commitRun ? 'commit' : ''}">${escapeHtml(run.label)}</span>${runPlatformChip(run)}</div>`
        );
      }
      if (runs.length === 0) rows.push('<div class="scenario-row">no runs yet</div>');
      rows.push('</div>');
    }
    return rows.join('');
  }
}

function bindRows(root: HTMLElement): void {
  for (const header of root.querySelectorAll<HTMLElement>('.tree-group[data-flow]')) {
    header.addEventListener('click', () => {
      const flow = header.dataset.flow!;
      update((current) => {
        current.collapsedFlows = current.collapsedFlows.includes(flow)
          ? current.collapsedFlows.filter((candidate) => candidate !== flow)
          : [...current.collapsedFlows, flow];
      });
      persistCollapsedFlows();
    });
  }
  for (const row of root.querySelectorAll<HTMLElement>('.run-row[data-scenario]')) {
    row.addEventListener('click', () => {
      const entry = state.catalog.find((candidate) => candidate.id === row.dataset.scenario);
      const newest = entry?.runs.find((run) => run.proof === 'product-run');
      if (entry) void selectScenario(newest?.runId, entry.id);
    });
  }
  for (const row of root.querySelectorAll<HTMLElement>('.scenario-row[data-run]')) {
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      void selectScenario(row.dataset.run!, row.dataset.scenario!);
    });
  }
}
