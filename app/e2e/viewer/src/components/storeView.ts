import { requestTrigger } from '../actions';
import { api } from '../api';
import { state, update } from '../state';
import type { StoreScreenshotExport } from '../../lib/types';

const exports = new Map<string, StoreScreenshotExport | 'loading' | 'missing'>();
const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function renderStoreView(root: HTMLElement): void {
  const busy = state.job?.status === 'running';
  const parts = [
    `<div class="store-view"><header class="store-intro"><div><h1>Store screenshots</h1>
    <p>Fourteen screens, one session per phone. Populated demo content. No payments or messages sent.</p></div>
    <div class="store-run-actions"><button class="primary" data-store-run="both" ${busy ? 'disabled' : ''}>Capture both</button>
    <button data-store-run="ios" ${busy ? 'disabled' : ''}>iPhone only</button>
    <button data-store-run="android" ${busy ? 'disabled' : ''}>Android only</button></div></header>`,
  ];
  for (const [driver, label] of [
    ['sim', 'iPhone'],
    ['android', 'Android'],
  ] as const) {
    const run = state.runs.find(
      (candidate) =>
        candidate.driver === driver &&
        candidate.suite === 'store-screenshots' &&
        candidate.status === 'complete' &&
        candidate.result?.passed === 1 &&
        !candidate.result.failed
    );
    parts.push(`<section><h2>${label}</h2>`);
    if (!run) {
      parts.push('<p class="empty">No completed capture yet. Start a capture above.</p></section>');
      continue;
    }
    const runId = `run-${run.runId}`;
    let exported = exports.get(runId);
    if (!exported) {
      exports.set(runId, 'loading');
      void api
        .storeExport(runId)
        .then((body) => {
          if (
            !Array.isArray(body.screenshots) ||
            ![8, 14].includes(body.screenshots.length) ||
            body.screenshots.some((image) => !/^\d{2}-[a-z-]+\.png$/.test(image.file))
          )
            throw new Error('Incomplete export');
          exports.set(runId, body);
        })
        .catch(() => exports.set(runId, 'missing'))
        .finally(() => update(() => {}));
      exported = 'loading';
    }
    parts.push(`<p class="meta">${escapeHtml(run.label)} · demo content</p>`);
    if (typeof exported === 'string') {
      parts.push(
        `<p>${exported === 'loading' ? 'Loading export…' : 'The export is not available yet. Check the run console.'}</p>`
      );
      if (exported === 'missing')
        parts.push(`<button data-store-refresh="${escapeHtml(runId)}">Refresh export</button>`);
    } else {
      if (exported.targets?.length)
        parts.push(
          `<p class="store-run-actions">${exported.targets
            .filter((target) => /^[a-z-]+\.zip$/.test(target.archive))
            .map(
              (target) =>
                `<a href="${api.runFileUrl(runId, `store/${target.archive}`)}" download="sovran-${driver}-${target.archive}">${escapeHtml(target.label)}${target.files ? ` · ${target.files.length} images` : ''} (.zip)</a>`
            )
            .join(' · ')}</p>`
        );
      parts.push(
        `<p><a href="${api.runFileUrl(runId, 'store/screenshots.zip')}" download="sovran-${driver === 'sim' ? 'iphone' : 'android'}-screenshots.zip">Download gallery (${exported.screenshots.length} images)</a></p><div class="store-grid">${exported.screenshots
          .map((image) => {
            const url = api.runFileUrl(runId, `store/${image.file}`);
            return `<figure><a href="${url}" target="_blank" rel="noopener"><img src="${url}" loading="lazy" alt="${escapeHtml(image.page)}" /></a><figcaption>${escapeHtml(image.page.replaceAll('-', ' '))}<span class="meta">${image.width} × ${image.height}</span><a href="${url}" download="${image.file}">Download PNG</a></figcaption></figure>`;
          })
          .join('')}</div>`
      );
    }
    parts.push('</section>');
  }
  root.innerHTML = parts.join('') + '</div>';
  root.querySelectorAll<HTMLButtonElement>('[data-store-refresh]').forEach((button) =>
    button.addEventListener('click', () => {
      exports.delete(button.dataset.storeRefresh!);
      update(() => {});
    })
  );
  root.querySelectorAll<HTMLButtonElement>('[data-store-run]').forEach((button) =>
    button.addEventListener('click', () =>
      requestTrigger(
        {
          kind: 'suite',
          suite: 'store-screenshots',
          platform: button.dataset.storeRun as 'both' | 'ios' | 'android',
        },
        'Capture store screenshots'
      )
    )
  );
}
