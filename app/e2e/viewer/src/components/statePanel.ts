/** Per-frame app-state panel: the zustand state-mirror snapshot and the coco
 * SQLite dump captured beside each screenshot, rendered as a collapsible JSON
 * tree in the Steps-pane visual language. Tab choice and expanded-node sets
 * live at module level (video-transport precedent in player.ts) so expanding a
 * node or switching tabs never triggers app-wide re-renders; documents are
 * memoized by rel path, which the runner's unchanged-state dedup makes highly
 * effective.
 *
 * Tree paths are `section¦idx¦idx…` — entry-index segments, never key names,
 * because store record keys (mint URLs) and db names (`coco.db`) contain dots
 * and other separators. Children render lazily on first expand so a multi-MB
 * dump never materializes as DOM up front. */
import { api } from '../api';
import { state, update } from '../state';
import type { ReelFrame } from './player';

type PanelTab = 'store' | 'db';

const SEP = '¦';

let tab: PanelTab = 'store';
/** Per-tab sets of expanded tree paths; survive frame navigation + patches. */
const expanded: Record<PanelTab, Set<string>> = { store: new Set(), db: new Set() };
const docCache = new Map<string, Promise<unknown>>();
let fetchToken = 0;
/** Top-level section key → value for the currently rendered document. */
let sectionValues = new Map<string, unknown>();
/** Sections that differ from the previous frame → the immediate child keys
 * that differ (for one-level-deep highlighting inside expanded sections). */
let changedSections = new Map<string, Set<string>>();
/** Filter the section list down to changed sections only. */
let changedOnly = false;
/** Re-run the current patch after a local (tab/filter) interaction. */
let repatch: (() => void) | undefined;

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fetchDoc(runId: string, rel: string): Promise<unknown> {
  let cached = docCache.get(rel);
  if (!cached) {
    // eslint-disable-next-line no-restricted-globals -- standalone browser dev tool (see api.ts)
    cached = fetch(api.runFileUrl(runId, rel)).then((response) => {
      if (!response.ok) throw new Error(`${rel}: ${response.status}`);
      return response.json();
    });
    // A failed fetch must not poison the cache for later revisits.
    cached.catch(() => docCache.delete(rel));
    docCache.set(rel, cached);
  }
  return cached;
}

// ── JSON tree ────────────────────────────────────────────────────────────────

const MAX_STRING = 200;

function isLeaf(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function previewOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value as object).length}}`;
  return '';
}

function leafHtml(value: unknown): string {
  if (value === null) return `<span class="jt-null">null</span>`;
  switch (typeof value) {
    case 'string': {
      const long = value.length > MAX_STRING;
      const shown = long ? `${value.slice(0, MAX_STRING)}…` : value;
      return `<span class="jt-str"${long ? ` title="${value.length} chars"` : ''}>"${escapeHtml(shown)}"</span>`;
    }
    case 'number':
      return `<span class="jt-num">${String(value)}</span>`;
    case 'boolean':
      return `<span class="jt-bool">${String(value)}</span>`;
    default:
      return `<span class="jt-str">${escapeHtml(String(value))}</span>`;
  }
}

function entriesOf(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>);
  }
  return [];
}

/** One tree node; display uses the real key, the path segment is the entry index. */
function nodeHtml(key: string, value: unknown, path: string): string {
  if (isLeaf(value)) {
    return (
      `<div class="jt-row">` +
      `<span class="jt-key">${escapeHtml(key)}</span>` +
      leafHtml(value) +
      `</div>`
    );
  }
  const count = entriesOf(value).length;
  if (count === 0) {
    return (
      `<div class="jt-row">` +
      `<span class="jt-key">${escapeHtml(key)}</span>` +
      `<span class="jt-badge">${Array.isArray(value) ? '[ ]' : '{ }'}</span>` +
      `</div>`
    );
  }
  const open = expanded[tab].has(path);
  return (
    `<details class="jt-node" data-path="${escapeHtml(path)}"${open ? ' open' : ''}>` +
    `<summary><span class="jt-key">${escapeHtml(key)}</span><span class="jt-badge">${previewOf(value)}</span></summary>` +
    `<div class="jt-children">${open ? childrenHtml(value, path) : ''}</div>` +
    `</details>`
  );
}

function childrenHtml(value: unknown, path: string): string {
  // Depth-1 children of a changed section carry per-key change marks.
  const changedKeys = changedSections.get(path);
  return entriesOf(value)
    .map(([key, item], index) => {
      const node = nodeHtml(key, item, `${path}${SEP}${index}`);
      return changedKeys?.has(key)
        ? node.replace(/^(<(?:div|details) class="[^"]*)/, '$1 changed')
        : node;
    })
    .join('');
}

function resolvePath(path: string): unknown {
  const [section, ...indices] = path.split(SEP);
  let value = sectionValues.get(section);
  for (const raw of indices) {
    const entries = entriesOf(value);
    const entry = entries[Number(raw)];
    if (!entry) return undefined;
    value = entry[1];
  }
  return value;
}

/** Top-level section (a store, or a db table): a Steps-style header row with a
 * count badge over a lazily-filled tree body. */
function sectionHtml(sectionKey: string, title: string, badge: string, value: unknown): string {
  sectionValues.set(sectionKey, value);
  const changed = changedSections.has(sectionKey);
  if (changedOnly && !changed) return '';
  const changedClass = changed ? ' changed' : '';
  if (isLeaf(value)) {
    return `<div class="state-section leaf${changedClass}"><span class="tok-name">${escapeHtml(title)}</span>${leafHtml(value)}</div>`;
  }
  const open = expanded[tab].has(sectionKey);
  return (
    `<details class="state-section${changedClass}" data-path="${escapeHtml(sectionKey)}"${open ? ' open' : ''}>` +
    `<summary><span class="tok-name">${escapeHtml(title)}</span><span class="jt-badge">${escapeHtml(badge)}</span></summary>` +
    `<div class="jt-children">${open ? childrenHtml(value, sectionKey) : ''}</div>` +
    `</details>`
  );
}

// ── change detection (vs the previous visible frame) ─────────────────────────

/** Section map for a document: store name → state, or `db¦table` → rows. */
function sectionsOf(doc: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (tab === 'store') {
    for (const [name, value] of Object.entries((doc as StoreDoc).stores ?? {})) {
      map.set(name, value);
    }
    return map;
  }
  for (const [dbName, db] of Object.entries((doc as DbDoc).dbs ?? {})) {
    for (const [table, rows] of Object.entries(db.tables ?? {})) {
      map.set(`${dbName}${SEP}${table}`, rows);
    }
  }
  return map;
}

/** Cheap per-section stringify compare; changed sections get their immediate
 * changed child keys for one-level-deep marks. Adds/removals count as changed. */
function computeChangedSections(doc: unknown, prevDoc: unknown): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const current = sectionsOf(doc);
  const previous = sectionsOf(prevDoc);
  for (const [key, value] of current) {
    const prev = previous.get(key);
    const currentJson = JSON.stringify(value);
    if (previous.has(key) && JSON.stringify(prev) === currentJson) continue;
    const changedKeys = new Set<string>();
    const prevEntries = new Map(entriesOf(prev));
    for (const [childKey, childValue] of entriesOf(value)) {
      if (
        !prevEntries.has(childKey) ||
        JSON.stringify(prevEntries.get(childKey)) !== JSON.stringify(childValue)
      ) {
        changedKeys.add(childKey);
      }
    }
    result.set(key, changedKeys);
  }
  return result;
}

// ── document shapes ──────────────────────────────────────────────────────────

interface StoreDoc {
  revision?: number;
  capturedAt?: number;
  stores?: Record<string, unknown>;
}

interface DbDoc {
  dbs?: Record<string, { tables?: Record<string, unknown[]>; rowCounts?: Record<string, number> }>;
}

function storeMetaRows(doc: StoreDoc, frame: ReelFrame): string {
  const rows: string[] = [];
  if (typeof doc.revision === 'number') {
    rows.push(`<span class="k">revision</span><span class="v">${doc.revision}</span>`);
  }
  if (typeof doc.capturedAt === 'number' && typeof frame.t === 'number') {
    const ageSec = Math.max(0, (frame.t - doc.capturedAt) / 1000);
    rows.push(
      `<span class="k">captured</span><span class="v">${ageSec.toFixed(1)}s before frame</span>`
    );
  }
  rows.push(
    `<span class="k">stores</span><span class="v">${doc.stores ? Object.keys(doc.stores).length : 0}</span>`
  );
  return rows.join('');
}

function dbMetaRows(doc: DbDoc): string {
  return Object.entries(doc.dbs ?? {})
    .map(([name, db]) => {
      const total = Object.values(db.rowCounts ?? {}).reduce((sum, n) => sum + n, 0);
      return `<span class="k">${escapeHtml(name)}</span><span class="v">${total} rows</span>`;
    })
    .join('');
}

function storeSections(doc: StoreDoc): string {
  return Object.entries(doc.stores ?? {})
    .map(([name, value]) => sectionHtml(name, name, previewOf(value), value))
    .join('');
}

function dbSections(doc: DbDoc): string {
  const parts: string[] = [];
  const dbNames = Object.keys(doc.dbs ?? {});
  for (const [dbName, db] of Object.entries(doc.dbs ?? {})) {
    for (const [table, rows] of Object.entries(db.tables ?? {})) {
      // Single-profile runs skip the db-name prefix noise.
      const title = dbNames.length > 1 ? `${dbName} · ${table}` : table;
      parts.push(
        sectionHtml(
          `${dbName}${SEP}${table}`,
          title,
          `${rows.length} row${rows.length === 1 ? '' : 's'}`,
          rows
        )
      );
    }
  }
  return parts.join('');
}

// ── panel shell + patch ──────────────────────────────────────────────────────

export function renderStatePaneShell(): string {
  return `<div class="state-pane" data-role="state-pane">
    <div class="steps-head">
      <span class="steps-title">State</span>
      <div class="view-toggle" role="tablist" aria-label="state kind">
        <button role="tab" class="seg" data-state-tab="store">Stores</button>
        <button role="tab" class="seg" data-state-tab="db">Coco DB</button>
      </div>
    </div>
    <div class="scenario-meta state-meta" data-role="state-meta"></div>
    <div class="state-filter">
      <label class="check"><input type="checkbox" data-action="changed-only" ${changedOnly ? 'checked' : ''}/> changed only</label>
    </div>
    <div class="state-list" data-role="state-list"></div>
  </div>`;
}

export function bindStatePane(root: HTMLElement): void {
  const pane = root.querySelector<HTMLElement>('[data-role=state-pane]');
  if (!pane) return;
  for (const button of pane.querySelectorAll<HTMLButtonElement>('[data-state-tab]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.stateTab as PanelTab;
      if (next === tab) return;
      tab = next;
      repatch?.();
    });
  }
  pane
    .querySelector<HTMLInputElement>('[data-action=changed-only]')
    ?.addEventListener('change', (event) => {
      changedOnly = (event.target as HTMLInputElement).checked;
      repatch?.();
    });
  // `toggle` does not bubble — capture-phase delegation catches every node.
  pane.addEventListener(
    'toggle',
    (event) => {
      const node = event.target;
      if (!(node instanceof HTMLDetailsElement)) return;
      const path = node.dataset.path;
      if (!path) return;
      if (node.open) {
        expanded[tab].add(path);
        const children = node.querySelector<HTMLElement>(':scope > .jt-children');
        if (children && !children.childElementCount) {
          const value = resolvePath(path);
          if (value !== undefined) children.innerHTML = childrenHtml(value, path);
        }
      } else {
        expanded[tab].delete(path);
      }
    },
    true
  );
}

/** Explain WHY a frame has no snapshot instead of a bare "not captured":
 * fake-lane runs never capture, pre-feature runs have nothing anywhere, and
 * the first frames of a sim run predate app boot (with a jump to the first
 * captured frame). */
function emptyStateHtml(frames: ReelFrame[]): string {
  if (state.runDetail?.driver === 'fake') {
    return `<span class="empty">fake-driver smoke — app state is only captured on simulator runs</span>`;
  }
  const relOf = (frame: ReelFrame) => (tab === 'store' ? frame.storeFile : frame.dbFile);
  const firstCaptured = frames.findIndex((frame) => relOf(frame));
  if (firstCaptured === -1) {
    return `<span class="empty">no app state in this run — it was recorded before state capture landed; re-run the scenario</span>`;
  }
  return (
    `<span class="empty">not captured — the app had not booted yet on this frame</span>` +
    `<button class="state-jump" data-action="state-jump" data-target="${firstCaptured}">jump to first captured frame (step ${firstCaptured + 1})</button>`
  );
}

export function patchStatePane(
  root: HTMLElement,
  runId: string,
  frames: ReelFrame[],
  index: number
): void {
  const pane = root.querySelector<HTMLElement>('[data-role=state-pane]');
  if (!pane) return;
  const frame: ReelFrame | undefined = frames[index];
  const previous: ReelFrame | undefined = frames[index - 1];
  repatch = () => patchStatePane(root, runId, frames, index);

  for (const button of pane.querySelectorAll<HTMLButtonElement>('[data-state-tab]')) {
    const active = button.dataset.stateTab === tab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }

  const meta = pane.querySelector<HTMLElement>('[data-role=state-meta]');
  const list = pane.querySelector<HTMLElement>('[data-role=state-list]');
  if (!meta || !list) return;

  const rel = frame ? (tab === 'store' ? frame.storeFile : frame.dbFile) : undefined;
  if (!rel) {
    meta.innerHTML = '';
    list.innerHTML = emptyStateHtml(frames);
    list
      .querySelector<HTMLButtonElement>('[data-action=state-jump]')
      ?.addEventListener('click', (event) => {
        const target = Number((event.currentTarget as HTMLElement).dataset.target);
        update((current) => {
          current.playing = false;
          current.frameIndex = target;
        });
      });
    return;
  }

  const prevRel = previous ? (tab === 'store' ? previous.storeFile : previous.dbFile) : undefined;
  const unchanged = prevRel !== undefined && prevRel === rel;
  const token = ++fetchToken;

  // Identical rels (runner dedup) skip the previous-doc fetch and comparison.
  const prevPromise =
    prevRel && !unchanged
      ? fetchDoc(runId, prevRel).catch(() => undefined)
      : Promise.resolve(undefined);

  Promise.all([fetchDoc(runId, rel), prevPromise])
    .then(([doc, prevDoc]) => {
      if (token !== fetchToken) return; // stale response while scrubbing
      sectionValues = new Map();
      changedSections = prevDoc ? computeChangedSections(doc, prevDoc) : new Map();
      const badge = unchanged
        ? `<span class="k">state</span><span class="v state-unchanged">unchanged</span>`
        : changedSections.size
          ? `<span class="k">state</span><span class="v state-changed">${changedSections.size} changed</span>`
          : '';
      const filterNote = changedOnly
        ? `<span class="empty">no changed sections on this frame</span>`
        : '';
      if (tab === 'store') {
        meta.innerHTML = storeMetaRows(doc as StoreDoc, frame!) + badge;
        list.innerHTML =
          storeSections(doc as StoreDoc) ||
          filterNote ||
          `<span class="empty">no stores in snapshot</span>`;
      } else {
        meta.innerHTML = dbMetaRows(doc as DbDoc) + badge;
        list.innerHTML =
          dbSections(doc as DbDoc) || filterNote || `<span class="empty">no tables in dump</span>`;
      }
    })
    .catch(() => {
      if (token !== fetchToken) return;
      meta.innerHTML = '';
      list.innerHTML = `<span class="empty">snapshot failed to load</span>`;
    });
}
