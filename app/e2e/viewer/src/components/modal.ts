import { state, update } from '../state';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderModal(root: HTMLElement): void {
  const modal = state.modal;
  if (!modal) {
    root.innerHTML = '';
    return;
  }

  if (modal.kind === 'trigger') {
    root.innerHTML = `<div class="backdrop"><div class="modal">
      <h2>${escapeHtml(modal.title)}</h2>
      <details><summary>Commands and device setup</summary><div class="argv">${modal.argvs
        .map((argv) => `<div>${escapeHtml(argv.join(' '))}</div>`)
        .join('')}</div></details>
      ${
        modal.funded
          ? `<label class="check"><input type="checkbox" data-action="fund-ack"/> this selection spends real (test) sats — I accept test fund loss</label>`
          : ''
      }
      <div class="actions">
        <button data-action="cancel">Cancel</button>
        <button data-action="confirm" class="primary">Run</button>
      </div>
    </div></div>`;
    const ack = root.querySelector<HTMLInputElement>('[data-action=fund-ack]');
    root.querySelector('[data-action=confirm]')?.addEventListener('click', () => {
      modal.send(Boolean(ack?.checked));
    });
  } else {
    root.innerHTML = `<div class="backdrop"><div class="modal">
      <h2>Delete all runs?</h2>
      <p>Deletes every run-* dir under e2e/artifacts (custody and legacy records stay).</p>
      ${
        modal.skipped.length
          ? `<p>Will be skipped (funds not reconciled or in progress):</p><ul>${modal.skipped
              .map((runId) => `<li>${escapeHtml(runId)}</li>`)
              .join('')}</ul>`
          : ''
      }
      <label class="check">type DELETE to confirm <input type="text" data-action="confirm-text" placeholder="DELETE"/></label>
      <div class="actions">
        <button data-action="cancel">Cancel</button>
        <button data-action="confirm" class="danger" disabled>Delete</button>
      </div>
    </div></div>`;
    const text = root.querySelector<HTMLInputElement>('[data-action=confirm-text]');
    const confirm = root.querySelector<HTMLButtonElement>('[data-action=confirm]');
    text?.addEventListener('input', () => {
      if (confirm) confirm.disabled = text.value !== 'DELETE';
    });
    confirm?.addEventListener('click', () => modal.send());
  }

  root.querySelector('[data-action=cancel]')?.addEventListener('click', () =>
    update((current) => {
      current.modal = undefined;
    })
  );
  root.querySelector('.backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget)
      update((current) => {
        current.modal = undefined;
      });
  });
}
