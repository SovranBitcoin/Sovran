import { api } from '../api';
import { state, update } from '../state';
import { renderConsoleLine } from './consoleFormat';

export function renderConsole(root: HTMLElement): void {
  const job = state.job;
  if (!job) {
    root.classList.add('hidden');
    return;
  }
  root.classList.remove('hidden');
  const heading =
    job.status === 'running'
      ? `${job.kind} job running${job.runId ? ` · ${job.runId}` : ''}`
      : `${job.kind} job exited ${job.exitCode === 0 ? '<span class="glyph-pass">✓</span>' : `<span class="glyph-fail">✗ code ${job.exitCode}</span>`}`;
  const killButton =
    job.status === 'running' && job.kind === 'run'
      ? `<button data-action="kill" class="danger">${job.killArmed ? 'really kill?' : 'kill job'}</button>`
      : '';
  // Copy reads the full buffer, not the 400-line render window below.
  const copyRow =
    job.status === 'exited' && job.exitCode !== 0
      ? `<div class="console-line copy-row"><button data-action="copy-output">copy full output</button></div>`
      : '';
  root.innerHTML = `<div class="console-head">
      <span>${heading}</span>
      <span class="spacer" style="flex:1"></span>
      ${killButton}
      <button data-action="dismiss">dismiss</button>
    </div>
    <div class="console-lines">${job.lines
      .slice(-400)
      .map(renderConsoleLine)
      .join('')}${copyRow}</div>`;
  root.querySelector('[data-action=dismiss]')?.addEventListener('click', () =>
    update((current) => {
      current.job = undefined;
    })
  );
  // Two-click arm instead of a native confirm: the first click flips the
  // label, the second sends the kill. The runner receives SIGTERM and aborts
  // fail-closed; the job's exit event arrives through the existing stream.
  root.querySelector('[data-action=kill]')?.addEventListener('click', () => {
    if (state.job?.id !== job.id) return;
    if (!state.job.killArmed) {
      update((current) => {
        if (current.job?.id === job.id) current.job.killArmed = true;
      });
      return;
    }
    void api
      .killJob()
      .catch((error: Error) =>
        update((current) => {
          if (current.job?.id === job.id) current.job.lines.push(`✗ kill failed: ${error.message}`);
        })
      )
      .finally(() =>
        update((current) => {
          if (current.job?.id === job.id) current.job.killArmed = false;
        })
      );
  });
  // Feedback mutates the button directly — an update() here would re-render
  // the whole app just to flip a label, and lose the flash on the next line.
  const copyButton = root.querySelector<HTMLButtonElement>('[data-action=copy-output]');
  copyButton?.addEventListener('click', () => {
    const lines = state.job?.id === job.id ? state.job.lines : job.lines;
    const flash = (label: string) => {
      copyButton.textContent = label;
      setTimeout(() => {
        copyButton.textContent = 'copy full output';
      }, 1500);
    };
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => flash('copied ✓'),
      () => flash('copy failed')
    );
  });
  const lines = root.querySelector('.console-lines');
  if (lines) lines.scrollTop = lines.scrollHeight;
}
