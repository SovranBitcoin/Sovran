/**
 * One page for a whole run (ADR 0033): every story with its purpose, whether
 * it passed, its video, and for each step the picture taken when the step was
 * satisfied, how long it took, how long the screen went on moving, and the
 * warnings and errors the app logged while it ran. A person and an agent read
 * the same thing; the page is built from the `report.json` each story leaves.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface ReportedEntry {
  level: string;
  event: string;
}
interface ReportedStep {
  name: string;
  ok: boolean;
  wallMs: number;
  screenMovedMs?: number;
  screenKeptMoving?: true;
  appUnresponsiveMs?: number;
  picture?: string;
  failure?: string;
  entries: ReportedEntry[];
}
export interface StoryReport {
  id: string;
  purpose: string;
  startsFrom: string;
  ok: boolean;
  failure?: string;
  video: string;
  spentMs: Record<string, number>;
  steps: ReportedStep[];
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** The warnings and errors of a step, by event, most frequent first. */
function trouble(step: ReportedStep): string {
  const counts = new Map<string, number>();
  for (const entry of step.entries) {
    if (entry.level !== 'warn' && entry.level !== 'error') continue;
    const key = `${entry.level} ${entry.event}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .toSorted((a, b) => b[1] - a[1])
    .map(([key, count]) => `<li>${escape(key)}${count > 1 ? ` ×${count}` : ''}</li>`)
    .join('');
}

function stepCard(folder: string, step: ReportedStep, index: number): string {
  const moved = step.screenKeptMoving
    ? 'screen never stopped moving'
    : step.screenMovedMs
      ? `screen moved ${step.screenMovedMs} ms more`
      : '';
  const logged = trouble(step);
  return `<figure class="${step.ok ? '' : 'failed'}">
${step.picture ? `<a href="${escape(folder)}/${escape(step.picture)}"><img loading="lazy" src="${escape(folder)}/${escape(step.picture)}" alt=""></a>` : '<div class="nopicture">no picture</div>'}
<figcaption><b>${index + 1}. ${escape(step.name)}</b><br>${step.wallMs} ms${moved ? ` · ${moved}` : ''}${step.appUnresponsiveMs ? `<p class="slow">app unresponsive for ${step.appUnresponsiveMs} ms</p>` : ''}
${step.failure ? `<p class="why">${escape(step.failure)}</p>` : ''}${logged ? `<ul>${logged}</ul>` : ''}</figcaption>
</figure>`;
}

function storySection(folder: string, report: StoryReport): string {
  const total = Object.values(report.spentMs).reduce((sum, ms) => sum + ms, 0);
  const steps = report.steps.reduce((sum, step) => sum + step.wallMs, 0);
  return `<section class="${report.ok ? 'passed' : 'failed'}" id="${escape(folder)}">
<h2><span class="verdict">${report.ok ? 'PASS' : 'FAIL'}</span> ${escape(folder)}</h2>
<p class="purpose">${escape(report.purpose)}</p>
<p class="facts">starts from <b>${escape(report.startsFrom)}</b> · ${seconds(total)} in all, ${seconds(steps)} of it in the steps · <a href="${escape(folder)}/${escape(report.video)}">video</a> · <a href="${escape(folder)}/report.json">log and timings</a></p>
${report.failure ? `<p class="why">${escape(report.failure)}</p>` : ''}
<div class="row"><video controls preload="none" src="${escape(folder)}/${escape(report.video)}"></video>
${report.steps.map((step, index) => stepCard(folder, step, index)).join('\n')}</div>
</section>`;
}

/** The page for the stories given, each with the folder (beside the page) its evidence is in. */
export function runReportPage(stories: { folder: string; report: StoryReport }[]): string {
  const failed = stories.filter(({ report }) => !report.ok);
  const ordered = [...failed, ...stories.filter(({ report }) => report.ok)];
  return `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stories: ${stories.length - failed.length} of ${stories.length} passed</title>
<style>
:root { color-scheme: dark; }
body { margin: 0 auto; max-width: 1500px; padding: 16px; background: #111; color: #ddd; font: 14px/1.45 -apple-system, system-ui, sans-serif; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin: 0; }
a { color: #8ab4f8; }
section { border-top: 1px solid #333; padding: 16px 0; }
.verdict { font-size: 12px; padding: 2px 6px; border-radius: 4px; background: #1d3b24; color: #7ee08f; }
.failed > h2 .verdict { background: #4a1d1d; color: #ff8a8a; }
.purpose { margin: 6px 0 2px; max-width: 80ch; } .facts { margin: 0 0 10px; color: #999; }
.why { color: #ff8a8a; margin: 4px 0; } .slow { color: #d7a64a; margin: 2px 0; }
.row { display: flex; gap: 10px; overflow-x: auto; align-items: flex-start; }
video, img, .nopicture { height: 420px; border-radius: 10px; background: #000; flex: none; }
video { aspect-ratio: 9 / 19.5; }
.nopicture { width: 194px; display: grid; place-items: center; color: #666; }
figure { margin: 0; flex: none; width: 194px; } figure.failed img { outline: 2px solid #ff8a8a; }
figcaption { font-size: 12px; color: #aaa; padding-top: 4px; } figcaption b { color: #ddd; }
ul { margin: 4px 0 0; padding-left: 16px; color: #d7a64a; }
</style>
<h1>${stories.length - failed.length} of ${stories.length} stories passed</h1>
${failed.length ? `<p class="why">Failed: ${failed.map(({ folder }) => `<a href="#${escape(folder)}">${escape(folder)}</a>`).join(', ')}</p>` : ''}
${ordered.map(({ folder, report }) => storySection(folder, report)).join('\n')}
`;
}

/** Write `index.html` into a folder of story evidence; returns its path. */
export function writeRunReport(outRoot: string): string {
  const stories = readdirSync(outRoot)
    .toSorted()
    .filter((folder) => existsSync(join(outRoot, folder, 'report.json')))
    .map((folder) => ({
      folder,
      report: JSON.parse(readFileSync(join(outRoot, folder, 'report.json'), 'utf8')) as StoryReport,
    }));
  const page = join(outRoot, 'index.html');
  writeFileSync(page, runReportPage(stories));
  return page;
}
