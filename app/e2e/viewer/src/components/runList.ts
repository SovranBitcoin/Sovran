import { selectScenario } from '../actions';
import { state } from '../state';
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

/** Flow-then-scenario left panel: scenarios grouped under their `flow:` facet
 * in the canonical FACETS order, runs (newest first) nested beneath each. The
 * selected scenario stays expanded; clicking a collapsed scenario opens its
 * newest run. */
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
    parts.push(`<div class="flow-group">${escapeHtml(flow)}</div>`);
    parts.push(...entries.map(renderScenarioRows));
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
    rows.push(
      `<div class="run-row${selected ? ' selected' : ''}${runs.length === 0 ? ' smoke' : ''}" data-scenario="${escapeHtml(entry.id)}" title="${escapeHtml(entry.tags.join(' '))}">` +
        `${latest ? okGlyph(latest.ok, latest.status) : ''}<span class="title">${escapeHtml(entry.name)}</span>` +
        `<span class="badge">${runs.length || ''}</span>` +
        `</div>`
    );
    if (selected) {
      rows.push('<div class="run-scenarios">');
      for (const run of runs) {
        const runSelected = state.selectedRunId === run.runId;
        rows.push(
          `<div class="scenario-row${runSelected ? ' selected' : ''}" data-run="${run.runId}" data-scenario="${escapeHtml(entry.id)}">` +
            `${okGlyph(run.ok, run.status)}<span class="${run.commitRun ? 'commit' : ''}">${escapeHtml(run.label)}</span></div>`
        );
      }
      if (runs.length === 0) rows.push('<div class="scenario-row">no runs yet</div>');
      rows.push('</div>');
    }
    return rows.join('');
  }
}

function bindRows(root: HTMLElement): void {
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
