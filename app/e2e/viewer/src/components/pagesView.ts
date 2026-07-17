import { api } from '../api';
import { loadPages } from '../actions';
import { state, update } from '../state';
import type { PageCapture } from '../../lib/types';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function captureFigure(capture: PageCapture): string {
  const url = api.runFileUrl(`run-${capture.runId}`, capture.file);
  const caption = `${capture.scenarioName}${capture.occurrence > 1 ? ` #${capture.occurrence}` : ''}`;
  const meta = `${capture.runLabel}${capture.stepId ? ` · ${capture.stepId}` : ''}`;
  return (
    `<figure title="${escapeHtml(`${capture.scenarioId} · ${meta}`)}">` +
    `<a href="${url}" target="_blank" rel="noopener"><img loading="lazy" src="${url}" alt="${escapeHtml(capture.page)}" /></a>` +
    `<figcaption>${escapeHtml(caption)}<span class="meta">${escapeHtml(meta)}</span></figcaption>` +
    `</figure>`
  );
}

/** Gallery of every capture of one canonical page across scenarios and runs.
 * Default scope is the newest passing product run per scenario; "all runs"
 * widens to every product run (situations over time). */
export function renderPagesView(root: HTMLElement): void {
  const { index, allRuns, loading, selectedPage } = state.pages;
  if (!index && !loading) {
    void loadPages();
  }

  const parts: string[] = ['<div class="pages-view">'];
  parts.push(
    `<div class="pages-controls">` +
      `<label class="check"><input type="checkbox" data-action="all-runs" ${allRuns ? 'checked' : ''}/> all runs</label>` +
      (loading ? '<span class="status-pill">loading…</span>' : '') +
      `</div>`
  );

  if (index && index.pages.length === 0) {
    parts.push('<span class="empty">no named captures in any product run yet</span>');
  }

  for (const group of index?.pages ?? []) {
    const expanded = selectedPage === undefined || selectedPage === group.page;
    parts.push(
      `<section class="page-group${expanded ? '' : ' collapsed'}">` +
        `<h2 class="clickable" data-page="${escapeHtml(group.page)}">${escapeHtml(group.page)}` +
        `<span class="count">${group.captures.length}</span></h2>` +
        (expanded
          ? `<div class="page-grid">${group.captures.map(captureFigure).join('')}</div>`
          : '') +
        `</section>`
    );
  }
  parts.push('</div>');
  root.innerHTML = parts.join('');

  root
    .querySelector<HTMLInputElement>('[data-action=all-runs]')
    ?.addEventListener('change', (event) => {
      void loadPages((event.target as HTMLInputElement).checked);
    });
  for (const heading of root.querySelectorAll<HTMLElement>('.page-group h2')) {
    heading.addEventListener('click', () =>
      update((current) => {
        const page = heading.dataset.page;
        current.pages.selectedPage = current.pages.selectedPage === page ? undefined : page;
      })
    );
  }
}
