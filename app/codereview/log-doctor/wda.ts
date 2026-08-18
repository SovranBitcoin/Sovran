/**
 * @fileoverview WebDriverAgent (WDA) primitives for the log-doctor CLI.
 *
 * Drives a real iOS device through WDA's REST API (localhost:8100) — tap,
 * swipe, screenshot, accessibility-tree introspection, clipboard, app
 * relaunch, and the matching wait/assert helpers.
 *
 * Lives in its own module (and not inline in `log-doctor/index.ts`) because
 * `test-dsl/executor.ts` imports the same primitives. With the primitives
 * inlined in `index.ts`, executor.ts had to import from `../index`, which
 * also imports `./test-dsl/executor` — a real module-graph cycle that
 * `analyze-structure` flagged. Moving the primitives here breaks the cycle
 * structurally: executor.ts and index.ts both depend on `./wda`, and
 * neither depends on the other.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';

export const WDA_BASE = process.env.WDA_BASE_URL || 'http://localhost:8100';

interface AXNode {
  type?: string;
  label?: string | null;
  name?: string | null;
  value?: string | null;
  rawIdentifier?: string | null;
  identifier?: string | null;
  rect?: { x: number; y: number; width: number; height: number };
  isVisible?: boolean | string;
  isEnabled?: boolean | string;
  children?: AXNode[];
}

export interface FlatNode {
  type: string;
  label: string;
  name: string;
  identifier: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  centerX: number;
  centerY: number;
  hasIdent: boolean;
  hasText: boolean;
}

/**
 * Optional sink for WDA recovery / bring-up log lines. When the TTY
 * reporter is active, it registers a sink that commits each line into
 * scrollback via the reporter's `commit()` path. Without the sink,
 * every `▸ WDA ...` / `[wda] ...` line was written directly to
 * `process.stderr`, which collided with the reporter's live-area
 * cursor math and corrupted the progress footer with duplicated
 * headers and bleed-through text. Routing through a sink keeps the
 * reporter in charge of its own cursor state.
 *
 * Default is null → lines fall through to `process.stderr.write` so
 * non-reporter callers (plain piped output, CI) see the same output
 * they did before.
 */
let recoveryLogSink: ((line: string) => void) | null = null;
export function setRecoveryLogSink(sink: ((line: string) => void) | null): void {
  recoveryLogSink = sink;
}
/**
 * Emit a single line of recovery/bring-up progress. Lines land in the
 * reporter's scrollback when a sink is registered, and on stderr
 * otherwise. Multi-line input is split so each line is committed
 * atomically through the sink — the reporter assumes one line per
 * call, and a single sink invocation with embedded newlines would
 * break its paint math.
 */
function emitRecoveryLine(line: string): void {
  // Strip a single trailing newline so callers that follow the
  // `stream.write('foo\n')` convention and callers that don't both
  // produce the same result.
  const normalized = line.endsWith('\n') ? line.slice(0, -1) : line;
  if (normalized.length === 0) return;
  if (recoveryLogSink) {
    for (const sub of normalized.split('\n')) recoveryLogSink(sub);
  } else {
    process.stderr.write(normalized + '\n');
  }
}

/**
 * Shared recovery promise. When a wdaRequest hits a transport-level
 * failure (tunnel dropped, forwarder died, port unbound), it triggers
 * an `ensureWDAReady()` pass. If another request is already running
 * that pass, it joins the in-flight promise instead of kicking off a
 * second parallel bring-up — parallel bring-ups race the pkill
 * cleanup and stomp on each other's tunnels.
 *
 * Reset to null once the promise settles so the NEXT drop (hours
 * later in a long test run) can trigger a fresh bring-up.
 */
let wdaRecoveryPromise: Promise<void> | null = null;
async function recoverWDA(): Promise<void> {
  // Any cached session is stale after a WDA restart.
  invalidateCachedSession();
  if (wdaRecoveryPromise) return wdaRecoveryPromise;
  wdaRecoveryPromise = (async () => {
    try {
      await ensureWDAReady();
    } finally {
      wdaRecoveryPromise = null;
    }
  })();
  return wdaRecoveryPromise;
}

export async function wdaRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<any> {
  const url = `${WDA_BASE}${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);

  // Transport-level retry with auto-recovery. WDA's userspace tunnel
  // and port forwarder are fragile on long runs — the forwarder can
  // die after minutes of traffic, leaving `localhost:8100` with
  // nothing listening. Every in-flight `wdaRequest` then fails with
  // `fetch failed`, the test runner tears down a cell, and all the
  // downstream cells also fail because nothing brought WDA back.
  //
  // Recovery strategy: on the first `fetch` throw, call `recoverWDA`
  // (which serialises through `ensureWDAReady` — the same bring-up
  // path the runner uses at startup) and retry the request once.
  // Only transport failures retry; HTTP-level errors (4xx/5xx from
  // a live WDA) surface immediately — they mean the request was
  // malformed or the target element is gone, not that the tunnel
  // died, and retrying would just mask the real cause.
  //
  // The retry is bounded at one attempt so a genuinely dead device
  // fails fast after ~180s (the ensureWDAReady budget) instead of
  // looping forever.
  let res: Response | null = null;
  let transportErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(url, init);
      break;
    } catch (err) {
      transportErr = err;
      if (attempt === 0) {
        emitRecoveryLine(`▸ WDA request failed (${(err as Error).message}) — attempting recovery…`);
        try {
          await recoverWDA();
          emitRecoveryLine(`▸ WDA recovered, retrying ${method} ${path}`);
        } catch (recoveryErr) {
          // Recovery itself failed — surface the original transport
          // error wrapped with the usual recovery hint, since that's
          // the most actionable message the user will see.
          throw new Error(
            `WDA unreachable at ${WDA_BASE} and recovery bring-up failed.\n` +
              `\n` +
              `Bring it up with:\n` +
              `  npm run dev          # Metro + WDA in one shot\n` +
              `  scripts/start-wda.sh # WDA only\n` +
              `\n` +
              `See docs/device-automation.md for the full setup.\n` +
              `Transport error: ${(err as Error).message}\n` +
              `Recovery error:  ${(recoveryErr as Error).message}`
          );
        }
        continue;
      }
      // Second attempt — give up with the original-looking message.
      throw new Error(
        `WDA unreachable at ${WDA_BASE}.\n` +
          `\n` +
          `Bring it up with:\n` +
          `  npm run dev          # Metro + WDA in one shot\n` +
          `  scripts/start-wda.sh # WDA only\n` +
          `\n` +
          `See docs/device-automation.md for the full setup.\n` +
          `Underlying error: ${(err as Error).message}`
      );
    }
  }
  if (!res) {
    // Unreachable because either `break` ran (res set) or the loop
    // threw — but TS needs a narrowing for the block below.
    throw new Error(
      `WDA unreachable at ${WDA_BASE}: ${transportErr instanceof Error ? transportErr.message : 'unknown'}`
    );
  }

  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `WDA returned non-JSON ${res.status} for ${method} ${path}: ${text.slice(0, 200)}`
    );
  }
  if (!res.ok) {
    const value = (parsed as { value?: { message?: string } }).value;
    throw new Error(
      `WDA ${res.status} ${method} ${path}: ${value?.message || JSON.stringify(parsed).slice(0, 300)}`
    );
  }
  return parsed;
}

/** Get the current accessibility tree without creating a session. */
export async function getCurrentTree(): Promise<AXNode> {
  const res = await wdaRequest('GET', '/source?format=json');
  if (!res.value) throw new Error('WDA /source returned no value');
  return res.value as AXNode;
}

export function flattenAll(node: AXNode, out: FlatNode[] = []): FlatNode[] {
  const rect = node.rect ?? null;
  const label = node.label || '';
  const name = node.name || '';
  const ident = node.rawIdentifier || node.identifier || '';
  out.push({
    type: node.type || '',
    label,
    name,
    identifier: ident,
    rect,
    centerX: rect ? Math.round(rect.x + rect.width / 2) : 0,
    centerY: rect ? Math.round(rect.y + rect.height / 2) : 0,
    hasIdent: !!ident,
    hasText: !!(label || name),
  });
  if (node.children) for (const c of node.children) flattenAll(c, out);
  return out;
}

/**
 * Find the back button of the topmost (most recently rendered) navigation
 * bar. iOS Stack screens render their back button as the FIRST Button
 * descendant of an `XCUIElementTypeNavigationBar`. When multiple modals are
 * stacked (e.g. wallet home + a presented modal), both nav bars are in the
 * tree — we want the LAST one, which corresponds to the topmost modal.
 *
 * Returns null when there's no nav bar with a back button (e.g. on the
 * root screen with no presented modal).
 */
function findFirstButtonDescendant(node: AXNode): AXNode | null {
  if (node.type === 'XCUIElementTypeButton') return node;
  if (node.children) {
    for (const c of node.children) {
      const found = findFirstButtonDescendant(c);
      if (found) return found;
    }
  }
  return null;
}

interface NavBackHit {
  button: AXNode;
  centerX: number;
  centerY: number;
}

export function findTopmostNavBackButton(tree: AXNode): NavBackHit | null {
  let last: NavBackHit | null = null;
  function walk(node: AXNode): void {
    if (node.type === 'XCUIElementTypeNavigationBar' && node.children) {
      const button = findFirstButtonDescendant(node);
      if (button && button.rect && button.rect.width > 0 && button.rect.height > 0) {
        last = {
          button,
          centerX: Math.round(button.rect.x + button.rect.width / 2),
          centerY: Math.round(button.rect.y + button.rect.height / 2),
        };
      }
    }
    if (node.children) for (const c of node.children) walk(c);
  }
  walk(tree);
  return last;
}

function ellipsis(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatNodeLine(n: FlatNode): string {
  const t = (n.type || '').replace('XCUIElementType', '').padEnd(12);
  const id = n.identifier ? `[${n.identifier}] ` : '';
  const labelOrName = n.label || n.name || '';
  const text = labelOrName ? `"${ellipsis(labelOrName, 60)}" ` : '';
  const at = n.rect ? `@${n.centerX},${n.centerY} ${n.rect.width}x${n.rect.height}` : '';
  return `${t} ${id}${text}${at}`.trimEnd();
}

export function formatTreeOutput(nodes: FlatNode[], showAll: boolean): string {
  // testID-first sort: nodes with rawIdentifier come first, then text-only nodes,
  // then everything else (only when --all). Within each bucket, sort by visual
  // position (top-down, left-right).
  const withId = nodes.filter((n) => n.hasIdent);
  const withText = nodes.filter((n) => !n.hasIdent && n.hasText);
  const rest = nodes.filter((n) => !n.hasIdent && !n.hasText);
  const positionSort = (a: FlatNode, b: FlatNode) => a.centerY - b.centerY || a.centerX - b.centerX;
  withId.sort(positionSort);
  withText.sort(positionSort);
  rest.sort(positionSort);

  const sections: string[] = [];
  if (withId.length > 0) {
    sections.push('# testID-targetable (preferred)');
    sections.push(...withId.map(formatNodeLine));
  } else {
    sections.push('# testID-targetable (preferred)');
    sections.push('  (none — none of the visible elements have a testID set)');
  }
  if (withText.length > 0) {
    sections.push('');
    sections.push('# text-only (fallback — fragile to copy/i18n)');
    sections.push(...withText.map(formatNodeLine));
  }
  if (showAll && rest.length > 0) {
    sections.push('');
    sections.push(`# unlabeled containers (--all, ${rest.length} nodes)`);
    sections.push(...rest.slice(0, 200).map(formatNodeLine));
    if (rest.length > 200) sections.push(`  …and ${rest.length - 200} more`);
  }
  return sections.join('\n');
}

export function findByTestID(nodes: FlatNode[], id: string): FlatNode | null {
  return nodes.find((n) => n.identifier === id) || null;
}

interface TextMatch {
  node: FlatNode;
  matchKind: 'exact' | 'substring';
}

export function findByText(nodes: FlatNode[], text: string): TextMatch | null {
  const exact = nodes.find(
    (n) =>
      n.rect && // must be tappable (has a rect)
      (n.label === text || n.name === text)
  );
  if (exact) return { node: exact, matchKind: 'exact' };
  const lower = text.toLowerCase();
  const sub = nodes.find(
    (n) =>
      n.rect &&
      ((n.label && n.label.toLowerCase().includes(lower)) ||
        (n.name && n.name.toLowerCase().includes(lower)))
  );
  if (sub) return { node: sub, matchKind: 'substring' };
  return null;
}

// ─── Cached WDA session for fast element queries ────────────────────────────
//
// `waitForID` and `waitForText` poll for element appearance. The old approach
// fetched the full accessibility tree (`GET /source?format=json`) each poll —
// fast on simple screens, but **seconds** on dense ones (~130 transaction
// rows). WDA's W3C `POST /session/{sid}/element` finds a single element by
// accessibility id WITHOUT serialising the whole tree, bringing per-poll cost
// from seconds down to ~20-80ms.
//
// The session is created lazily on first use, reused across all fast-path
// calls, and invalidated on any error that suggests staleness.

let _cachedSessionId: string | null = null;
let _sessionCreating: Promise<string> | null = null;

async function getCachedSession(): Promise<string> {
  if (_cachedSessionId) return _cachedSessionId;
  // Dedup concurrent callers — don't create N sessions in parallel.
  if (_sessionCreating) return _sessionCreating;
  _sessionCreating = (async () => {
    const created = await wdaRequest('POST', '/session', {
      capabilities: { alwaysMatch: { platformName: 'iOS' } },
    });
    const sid: string | undefined = created.sessionId || created.value?.sessionId;
    if (!sid) throw new Error('WDA POST /session did not return a sessionId');
    _cachedSessionId = sid;
    return sid;
  })();
  try {
    return await _sessionCreating;
  } finally {
    _sessionCreating = null;
  }
}

export function invalidateCachedSession(): void {
  const old = _cachedSessionId;
  _cachedSessionId = null;
  if (old) {
    // Best-effort cleanup in the background — don't block the caller.
    wdaRequest('DELETE', `/session/${old}`).catch(() => {});
  }
}

// ─── Fast element finders ───────────────────────────────────────────────────
//
// These use the W3C WebDriver `POST /session/{sid}/element` endpoint which
// resolves a single element without serialising the full tree. Returns true
// if the element exists, false if WDA reports "no such element", and throws
// on session-level errors so the caller can invalidate and fall back.

async function fastFindByID(sid: string, accessibilityId: string): Promise<boolean> {
  try {
    await wdaRequest('POST', `/session/${sid}/element`, {
      using: 'accessibility id',
      value: accessibilityId,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // WDA returns status 7 (NoSuchElement) or a 404 when the element
    // isn't in the tree — that's a normal "not found", not an error.
    if (/no such element|NoSuchElement/i.test(msg) || msg.includes('404')) {
      return false;
    }
    throw err; // session-level error — propagate
  }
}

async function fastFindByText(sid: string, text: string): Promise<boolean> {
  const escaped = text.replace(/'/g, "\\'");
  try {
    await wdaRequest('POST', `/session/${sid}/element`, {
      using: '-ios predicate string',
      value: `label == '${escaped}' OR name == '${escaped}'`,
    });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/no such element|NoSuchElement/i.test(msg) || msg.includes('404')) {
      return false;
    }
    throw err;
  }
}

async function ephemeralSession<T>(fn: (sessionId: string) => Promise<T>): Promise<T> {
  const created = await wdaRequest('POST', '/session', {
    capabilities: { alwaysMatch: { platformName: 'iOS' } },
  });
  const sessionId: string | undefined = created.sessionId || created.value?.sessionId;
  if (!sessionId) {
    throw new Error(`WDA POST /session did not return a sessionId: ${JSON.stringify(created)}`);
  }
  try {
    return await fn(sessionId);
  } finally {
    try {
      await wdaRequest('DELETE', `/session/${sessionId}`);
    } catch {
      /* best effort */
    }
  }
}

export async function tapXY(x: number, y: number): Promise<void> {
  await ephemeralSession((sid) => wdaRequest('POST', `/session/${sid}/wda/tap`, { x, y }));
}

/**
 * Cached logical window size from WDA `GET /window/size`. Cached because the
 * iPhone's logical bounds don't change between steps and the round-trip is
 * non-trivial — we typically only need it for swipe coordinate math.
 */
let cachedWindowSize: { width: number; height: number } | null = null;
async function getWindowSize(): Promise<{ width: number; height: number }> {
  if (cachedWindowSize) return cachedWindowSize;
  const size = await ephemeralSession(async (sid) => {
    const res = await wdaRequest('GET', `/session/${sid}/window/size`);
    const value = (res.value || res) as { width?: number; height?: number };
    if (typeof value.width !== 'number' || typeof value.height !== 'number') {
      throw new Error(`WDA /window/size returned unexpected payload: ${JSON.stringify(res)}`);
    }
    return { width: value.width, height: value.height };
  });
  cachedWindowSize = size;
  return size;
}

/**
 * Perform a flick (fast swipe with velocity) from one logical screen point to
 * another via WDA's W3C `POST /session/{sid}/actions` endpoint.
 *
 * `wda/dragfromtoforduration` is a press-and-hold-then-drag — it doesn't
 * impart velocity, so iOS treats it as a slow drag rather than a flick.
 * That's the wrong gesture for sheet dismissal: iOS snaps the sheet back
 * unless EITHER the drag passes the dismissal threshold OR the release
 * velocity is high enough. We use the W3C action sequence to control the
 * exact pointer-move timing, giving a clean flick that iOS recognises.
 *
 * `moveDurationMs` is the duration of the pointerMove from `from` to `to`.
 * Shorter = higher velocity = more flick-like. ~120ms is a good default.
 */
async function flickFromTo(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  moveDurationMs: number = 120
): Promise<void> {
  await ephemeralSession((sid) =>
    wdaRequest('POST', `/session/${sid}/actions`, {
      actions: [
        {
          type: 'pointer',
          id: 'finger1',
          parameters: { pointerType: 'touch' },
          actions: [
            { type: 'pointerMove', duration: 0, x: fromX, y: fromY },
            { type: 'pointerDown', button: 0 },
            { type: 'pause', duration: 30 },
            { type: 'pointerMove', duration: moveDurationMs, x: toX, y: toY },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    })
  );
}

/**
 * Perform a directional swipe across the screen.
 *
 * Logical coordinates are taken from `getWindowSize()` so the gesture works
 * the same on every device. The swipe spans 70% of the relevant axis with a
 * brisk 0.35s duration — long enough to register as a flick but short enough
 * to feel natural.
 */
export async function swipe(direction: 'up' | 'down' | 'left' | 'right'): Promise<void> {
  const { width, height } = await getWindowSize();
  const cx = width / 2;
  const cy = height / 2;
  const span = (axis: number) => axis * 0.35; // half of the 70% travel
  let from: { x: number; y: number };
  let to: { x: number; y: number };
  switch (direction) {
    case 'down':
      from = { x: cx, y: cy - span(height) };
      to = { x: cx, y: cy + span(height) };
      break;
    case 'up':
      from = { x: cx, y: cy + span(height) };
      to = { x: cx, y: cy - span(height) };
      break;
    case 'left':
      from = { x: cx + span(width), y: cy };
      to = { x: cx - span(width), y: cy };
      break;
    case 'right':
      from = { x: cx - span(width), y: cy };
      to = { x: cx + span(width), y: cy };
      break;
  }
  await flickFromTo(from.x, from.y, to.x, to.y, 120);
}

/**
 * Dismiss the topmost iOS modal sheet by performing the native swipe-down
 * gesture from the navigation bar area to the bottom of the screen.
 *
 * Used as a fast alternative to `relaunch-app` when a test wants to return
 * to the root screen after pushing through a modal stack (e.g. receive-flow,
 * send-flow). The gesture has to start in a non-scrollable region near the
 * top — the nav bar at y≈80–110 logical points is the most reliable spot.
 *
 * iOS dismisses a sheet when EITHER:
 *   - the drag passes ~50% of the modal height, OR
 *   - the release velocity is high enough to be a flick.
 *
 * We use a long, brisk drag (top → 90% of screen, 0.4s) so we hit both
 * conditions and dismiss reliably across screen sizes.
 */
export async function dismissModal(): Promise<void> {
  const { width, height } = await getWindowSize();
  // Start the swipe BELOW the iOS notification banner zone (~y=0-110)
  // and BELOW the modal nav bar (which can be obscured by a banner).
  // y≈130 lands in the top of the modal's content area: when the scroll
  // is at the top (true after every navigation in our tests), iOS treats
  // the downward drag as a sheet-dismiss gesture rather than a scroll.
  // This avoids the gesture being intercepted by an arriving push
  // notification banner.
  const fromX = Math.round(width / 2);
  const fromY = Math.round(Math.min(130, height * 0.16));
  const toX = fromX;
  const toY = Math.round(height * 0.92);
  // 100ms move duration → ~7000 pts/sec on a 850-tall device — well above
  // iOS's flick-velocity threshold so the sheet dismisses on release rather
  // than snapping back.
  await flickFromTo(fromX, fromY, toX, toY, 100);
  // Settle the dismissal animation so subsequent waits see the destination.
  await sleep(500);
}

export async function typeKeys(text: string): Promise<void> {
  await ephemeralSession((sid) =>
    wdaRequest('POST', `/session/${sid}/wda/keys`, { value: text.split('') })
  );
}

export async function pressHome(): Promise<void> {
  await ephemeralSession((sid) => wdaRequest('POST', `/session/${sid}/wda/homescreen`));
}

export async function relaunchApp(bundleId: string): Promise<void> {
  await ephemeralSession(async (sid) => {
    try {
      await wdaRequest('POST', `/session/${sid}/wda/apps/terminate`, { bundleId });
    } catch {
      /* may not be running */
    }
    await wdaRequest('POST', `/session/${sid}/wda/apps/launch`, { bundleId });
  });
  // Expo dev clients show a "Dev tools" menu sheet on launch that can render
  // anywhere from 0 to ~15 seconds after the process starts, and sometimes
  // re-renders right after dismissal. Poll aggressively: every 400ms for
  // 15 seconds, dismissing every xmark we find. After a successful dismiss,
  // do an extra 2-second confirmation pass to catch a delayed second
  // instance. Soft-fails if the menu never appears (production builds).
  await dismissDevMenuRepeatedly(15_000);
}

/**
 * Repeatedly poll for the Expo dev menu [xmark] close button and tap it
 * whenever it appears. After the first successful dismiss, we run an
 * extra confirmation window because the dev menu can re-render moments
 * after the initial dismissal animation completes.
 *
 * Used by `relaunchApp` (long initial window) and by the test executor's
 * pre-tap pre-flight (short window — see preflightDismissDevMenu).
 */
async function dismissDevMenuRepeatedly(totalMs: number): Promise<void> {
  const start = Date.now();
  let dismissedAt = 0;
  while (Date.now() - start < totalMs) {
    try {
      const tree = await getCurrentTree();
      const flat = flattenAll(tree);
      const xmark = findByTestID(flat, 'xmark');
      if (xmark && xmark.rect) {
        await tapXY(xmark.centerX, xmark.centerY);
        await sleep(400);
        dismissedAt = Date.now();
        continue; // immediately recheck — sometimes a second sheet renders
      }
      // No xmark right now. If we already dismissed once, give the dev
      // menu a 2-second grace window to re-render. Otherwise keep polling.
      if (dismissedAt && Date.now() - dismissedAt > 2000) return;
    } catch {
      /* WDA may briefly drop the source while the app is restarting */
    }
    await sleep(400);
  }
}

/**
 * Quick (single-shot) check for the dev menu, used by the test executor
 * before each tap. Bounded at ~600ms total so it doesn't slow down clean
 * runs. The full retry behaviour stays in `dismissDevMenuRepeatedly`.
 */
export async function preflightDismissDevMenu(): Promise<void> {
  // Loop the recovery logic up to 3 times. Why: several obstructions
  // can coexist (e.g. a notification banner sitting on top of the app
  // switcher, because a background coco-created payment notification
  // arrived after an earlier gesture pushed Sovran into the switcher).
  // A one-shot preflight handles the first-matched condition and
  // returns; the next step then re-fetches the tree, finds the SECOND
  // condition still present, and fails before another preflight runs.
  // Iterating here keeps the whole recovery bounded to one step entry
  // but lets multiple obstructions drain in a single pass.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const tree = await getCurrentTree();
      const flat = flattenAll(tree);

      // ── 0. iOS paste permission dialog — HIGHEST PRIORITY ──
      // This system alert can overlay both the app AND the app switcher,
      // blocking all interaction underneath. Must be dismissed first.
      const allowPaste = flat.find(
        (n) =>
          (n.label === 'Allow Paste' || n.name === 'Allow Paste') && n.rect && n.rect.width > 30
      );
      if (allowPaste && allowPaste.rect) {
        await tapXY(allowPaste.centerX, allowPaste.centerY);
        await sleep(400);
        continue;
      }

      // ── 1. iOS App Switcher (Sovran is in background) — HIGHEST PRIORITY ──
      // Detected via SBSwitcherWindow / AppSwitcherContentView in the
      // tree. If this is present, nothing else matters — taps into the
      // app will just land on the switcher background. Bring the app
      // back to foreground FIRST, then re-check for notifications or
      // dev menus on the next iteration.
      //
      // The card has a stable testID
      // `card:com.sovranbitcoin.dev:sceneID:com.sovranbitcoin.dev-default`.
      const switcher = flat.find((n) => n.identifier === 'SBSwitcherWindow:Main');
      if (switcher) {
        const card = flat.find(
          (n) => n.identifier && n.identifier.startsWith('card:com.sovranbitcoin.dev:sceneID')
        );
        if (card && card.rect) {
          await tapXY(card.centerX, card.centerY);
          await sleep(600);
          continue; // recheck — a banner may still be on top
        }
        // No card visible — fall back to terminate + relaunch to bail
        // out of whatever switcher state we're stuck in.
        await relaunchApp('com.sovranbitcoin.dev');
        continue;
      }

      // ── 2. iOS notification banner ──
      // Detected via NotificationShortLookView (iOS 16+) or
      // ShortLook.Platter (iOS 15). The banner overlays the top portion
      // of the screen and absorbs taps beneath it.
      //
      // IMPORTANT: the previous implementation did a fast 200pt upward
      // flick starting at the banner's centre. On a tall modern iPhone
      // a fast upward flick anywhere near the top of the screen can
      // race iOS's edge-gesture recogniser and trigger the app
      // switcher, which is exactly what broke the downstream tests.
      //
      // Safer approach: swipe upward ONLY within the banner's own rect
      // — start at the banner's bottom edge, end just above its top —
      // and use a slower move duration so iOS recognises it as a
      // standard banner dismiss drag, not a system-edge flick.
      const notification = flat.find(
        (n) => n.identifier === 'NotificationShortLookView' || n.identifier === 'ShortLook.Platter'
      );
      if (notification && notification.rect) {
        const r = notification.rect;
        const cx = Math.round(r.x + r.width / 2);
        const bottom = Math.round(r.y + r.height * 0.85);
        const top = Math.round(Math.max(10, r.y + r.height * 0.1));
        // 300ms move duration over ~50-80pt — inside-banner drag, not a
        // fast system flick.
        await flickFromTo(cx, bottom, cx, top, 300);
        await sleep(500);
        continue; // re-check: dismissing the banner may have revealed a dev menu
      }

      // ── 3. Expo dev menu (xmark close button) ──
      const xmark = findByTestID(flat, 'xmark');
      if (xmark && xmark.rect) {
        await tapXY(xmark.centerX, xmark.centerY);
        await sleep(400);
        continue;
      }

      // Nothing to recover from — we're clean.
      return;
    } catch {
      /* best effort — WDA may briefly drop the source; retry */
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function takeScreenshot(outPath?: string): Promise<string> {
  // Sessionless screenshot endpoint.
  const res = await wdaRequest('GET', '/screenshot');
  if (!res.value) throw new Error('WDA /screenshot returned no value');
  const target = outPath || nodePath.join(process.cwd(), `wda-${Date.now()}.png`);
  fs.writeFileSync(target, Buffer.from(res.value, 'base64'));
  return target;
}

/** Build the "you used a fallback — add a testID" nudge for an agent. */
export function buildAddTestIDNudge(node: FlatNode, calledAs: string): string {
  const labelOrName = node.label || node.name || '(unlabeled)';
  const grepTerm = labelOrName.replace(/"/g, '\\"');
  const suggestedID = labelOrName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return [
    '',
    '⚠  TAPPED BY VISIBLE TEXT — please add a testID',
    '',
    `   You ran:  ${calledAs}`,
    `   Element:  ${node.type.replace('XCUIElementType', '')} "${labelOrName}" @(${node.centerX},${node.centerY})`,
    '',
    '   This match is fragile to copy or i18n changes. To make future taps',
    '   stable, add a testID to the source component:',
    '',
    `     1) Find it:  rg -n '${grepTerm}' --type tsx --type ts`,
    `     2) Add prop: testID="${suggestedID}"`,
    '        (on the <Pressable>, <Button>, or ButtonHandlerButton config)',
    '     3) Save — Metro hot-reloads the dev client automatically.',
    `     4) Next time:  npm run log-doctor -- phone tap-id ${suggestedID}`,
    '',
    '   Sovran convention: kebab-case `<screen>-<action>`, e.g.',
    '   `receive-fixed-amount`, `send-confirm`, `mint-add`.',
  ].join('\n');
}

export function buildCoordTapNudge(x: number, y: number): string {
  return [
    '',
    '⚠  COORDINATE-BASED TAP — brittle, please switch to a testID',
    '',
    `   You ran:  phone tap-xy ${x} ${y}`,
    '',
    '   Coordinates break on screen-size, layout, or theme changes. Replace',
    '   this with a testID-based tap:',
    '',
    '     1) Inspect the screen:  npm run log-doctor -- phone tree',
    '     2) If the target element has a `[testID]` listed → use it:',
    '          npm run log-doctor -- phone tap-id <testID>',
    '     3) If it does NOT have one → add one in the source component',
    '        (kebab-case, e.g. `receive-fixed-amount`) and use tap-id after',
    '        Metro hot-reloads.',
  ].join('\n');
}

const STEP_TIMEOUT_MS = 90_000;

/**
 * Read the iOS clipboard via WDA. iOS 14+ blocks pasteboard reads from
 * background apps, so we have to briefly bring the WDA runner to the
 * foreground, read, and then re-activate the target app. The user sees a
 * brief visual flicker between WDA and Sovran — that's expected.
 */
export async function readClipboard(targetBundleId = 'com.sovranbitcoin.dev'): Promise<string> {
  return await ephemeralSession(async (sid) => {
    // Step 1: bring the WDA runner to the foreground so iOS allows the read.
    const wdaBundle = 'com.kelbie.WebDriverAgentRunner.xctrunner';
    try {
      await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, { bundleId: wdaBundle });
      // Brief settle so foreground state actually flips before the read.
      await sleep(400);
    } catch {
      /* if activation fails, attempt the read anyway */
    }

    // Step 2: read the pasteboard.
    let text = '';
    try {
      const res = await wdaRequest('POST', `/session/${sid}/wda/getPasteboard`, {
        contentType: 'plaintext',
      });
      const b64 = res.value;
      if (typeof b64 === 'string') {
        text = Buffer.from(b64, 'base64').toString('utf-8');
      }
    } finally {
      // Step 3: bring the target app back to the foreground regardless of
      // whether the read succeeded, so subsequent steps see the right
      // screen. Note: NO explicit post-activate sleep — the next step's
      // own preflight (tap, keypad, capture all call
      // `preflightDismissDevMenu` first, which always fetches the tree)
      // naturally gives the target app time to return to foreground.
      // The old `await sleep(400)` here added 400ms of dead time to
      // every clipboard read and wasn't load-bearing in practice.
      try {
        await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, {
          bundleId: targetBundleId,
        });
      } catch {
        /* best effort */
      }
    }
    return text;
  });
}

/**
 * Write to the iOS clipboard via WDA. Same foreground dance as
 * readClipboard — iOS blocks pasteboard writes from background apps.
 */
export async function writeClipboard(
  text: string,
  targetBundleId = 'com.sovranbitcoin.dev'
): Promise<void> {
  await ephemeralSession(async (sid) => {
    const wdaBundle = 'com.kelbie.WebDriverAgentRunner.xctrunner';
    try {
      await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, { bundleId: wdaBundle });
      await sleep(400);
    } catch {
      /* if activation fails, attempt the write anyway */
    }

    try {
      const b64 = Buffer.from(text, 'utf-8').toString('base64');
      await wdaRequest('POST', `/session/${sid}/wda/setPasteboard`, {
        content: b64,
        contentType: 'plaintext',
      });
    } finally {
      try {
        await wdaRequest('POST', `/session/${sid}/wda/apps/activate`, {
          bundleId: targetBundleId,
        });
      } catch {
        /* best effort */
      }
    }
  });
}

/**
 * Read an element's label/name via the cached WDA session. Returns the
 * label string or null if not found. Used by capture steps to avoid
 * the full tree fetch (~15-30s) when only one element's text is needed.
 */
export async function captureElementLabel(accessibilityId: string): Promise<string | null> {
  try {
    const sid = await getCachedSession();
    const findRes = await wdaRequest('POST', `/session/${sid}/element`, {
      using: 'accessibility id',
      value: accessibilityId,
    });
    const eid: string | undefined = findRes.value?.ELEMENT || findRes.value?.element;
    if (!eid) return null;
    // Try label first, then name.
    for (const attr of ['label', 'name']) {
      const res = await wdaRequest('GET', `/session/${sid}/element/${eid}/attribute/${attr}`);
      if (typeof res.value === 'string' && res.value.length > 0) {
        return res.value;
      }
    }
    return null;
  } catch {
    invalidateCachedSession();
    return null;
  }
}

export async function tapByID(id: string): Promise<void> {
  // ── Fast path: session-based element find + rect ──
  // Avoids the full tree serialisation (seconds on dense screens) by
  // using two lightweight session calls: POST /element → GET /element/{eid}/rect.
  try {
    const sid = await getCachedSession();
    const findRes = await wdaRequest('POST', `/session/${sid}/element`, {
      using: 'accessibility id',
      value: id,
    });
    const eid: string | undefined = findRes.value?.ELEMENT || findRes.value?.element;
    if (eid) {
      const rectRes = await wdaRequest('GET', `/session/${sid}/element/${eid}/rect`);
      const r = rectRes.value;
      if (r && typeof r.x === 'number') {
        const cx = Math.round(r.x + r.width / 2);
        const cy = Math.round(r.y + r.height / 2);
        // Off-screen guard (same logic as the full-tree path).
        const { width, height } = await getWindowSize();
        if (cx >= 0 && cx <= width && cy >= 0 && cy <= height) {
          await tapXY(cx, cy);
          return;
        }
        throw new Error(
          `element [${id}] is off-screen (center ${cx},${cy} outside ${width}x${height} viewport). ` +
            `Use \`scroll until #${id} visible\` before tapping.`
        );
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Off-screen errors should propagate, not fall through.
    if (msg.includes('is off-screen')) throw err;
    // "No such element" or session errors → fall through to full-tree path.
    if (!/no such element|NoSuchElement/i.test(msg) && !msg.includes('404')) {
      invalidateCachedSession();
    }
  }

  // ── Full-tree fallback ──
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  const node = findByTestID(flat, id);
  if (!node) {
    const visible = flat
      .filter((n) => n.hasIdent)
      .map((n) => `  ${n.identifier}`)
      .slice(0, 20)
      .join('\n');
    throw new Error(
      `no element with testID="${id}" on the current screen.\n` +
        (visible ? `visible testIDs:\n${visible}` : '(no testIDs visible)')
    );
  }
  if (!node.rect) throw new Error(`element [${id}] has no rect`);

  const { width, height } = await getWindowSize();
  if (node.centerX < 0 || node.centerX > width || node.centerY < 0 || node.centerY > height) {
    throw new Error(
      `element [${id}] is off-screen (center ${node.centerX},${node.centerY} outside ${width}x${height} viewport). ` +
        `Use \`scroll until #${id} visible\` before tapping — XCUITest will otherwise route the injected touch to whatever's at the visible edge.`
    );
  }

  await tapXY(node.centerX, node.centerY);
}

/**
 * Scroll the screen in `direction` (`up` = swipe finger up = content
 * moves up = later items come into view) until the node identified by
 * `predicate` is FULLY inside the current viewport, or until the
 * timeout expires.
 *
 * "Fully inside" means the whole `rect` — top, bottom, left, right —
 * is within the window bounds, with a small inset so the target isn't
 * flush against the status bar or home-indicator area (both of which
 * absorb taps). Short, repeated flicks (not one big swipe) because
 * iOS's scroll inertia + XCUITest's tree-refresh latency make it
 * trivial to overshoot on a big flick.
 *
 * The predicate is a function that inspects the current tree and
 * returns the target node (or null if it can't be found yet). That
 * way this helper works for both `#foo` exact matches and
 * `#foo-prefix*` wildcards — the executor passes the appropriate
 * lookup function.
 *
 * Returns the final matched node on success; throws on timeout with
 * a message listing what *was* found, to help the user figure out
 * whether they mistyped the selector or whether the list just didn't
 * contain what they expected.
 */
export async function scrollUntilVisible(
  predicate: (flat: FlatNode[]) => FlatNode | null,
  // Direction is a *hint*, used only when the target can't be found in
  // the tree at all. When the target IS found, we compute the direction
  // from its actual rect — scrolling the opposite way wastes iterations
  // and misleads the error message on timeout. `up` = swipe finger up
  // = content moves up = reveal rows below the current viewport.
  hintDirection: 'up' | 'down',
  label: string,
  // Scroll-until gets its own, longer timeout by default because each
  // iteration pulls a full `/source?format=json` tree from WDA, which
  // can take several seconds on a dense screen (e.g. the wallet home
  // with a loaded transaction list). 90s gives enough iterations to
  // scroll a long list without being so permissive that a stuck test
  // hangs the runner indefinitely.
  timeoutMs: number = STEP_TIMEOUT_MS
): Promise<FlatNode> {
  const { width, height } = await getWindowSize();
  // Vertical safe-area insets — the home indicator at the bottom of
  // modern iPhones overlaps the last ~34pt of the window and any tap
  // within it is routed to the system gesture recognizer, not the app.
  // The notch area at the top is less of a concern (most scroll
  // containers start below the nav bar) but we pad both sides for
  // symmetry.
  const SAFE_TOP = 60;
  const SAFE_BOTTOM = 60;
  const viewportTop = SAFE_TOP;
  const viewportBottom = height - SAFE_BOTTOM;

  const isFullyVisible = (node: FlatNode): boolean => {
    if (!node.rect) return false;
    const r = node.rect;
    return (
      r.x >= 0 && r.y >= viewportTop && r.x + r.width <= width && r.y + r.height <= viewportBottom
    );
  };

  // ADAPTIVE flicks anchored in the LOWER half of the screen. The
  // geometry has to respect three simultaneous constraints:
  //
  //   1. **Tree-fetch cost dominates.** Each iteration pulls a full
  //      `/source?format=json` tree from WDA. On a dense wallet home
  //      (~130 transaction rows mounted because `showMore=true` uses
  //      a flat VStack, not a virtualized list), that fetch runs
  //      several seconds. Every wasted iteration blows ~10% of the
  //      60s budget — the loop can't afford to iterate 20 times.
  //
  //   2. **Monotonic convergence, not ping-pong.** A fixed 50%-span
  //      flick that misses the target's viewport gap by even one flick
  //      puts the target ABOVE the viewport the next iteration, then
  //      the direction flips and the next flick overshoots the other
  //      way. A big-enough list + bad-enough timing produces infinite
  //      oscillation. The fix: AIM at the viewport CENTER, not at the
  //      opposite side. On each iteration, compute the delta between
  //      the target's centre-y and the viewport's centre-y, and flick
  //      by exactly that distance (clamped).
  //
  //   3. **Don't land inside the AccountPagerView Swiper.** The
  //      wallet home's top ~36% is a horizontal
  //      react-native-web-infinite-swiper that absorbs vertical
  //      gestures originating inside its hit region. Every flick
  //      must START below it (flickLowY anchored at ~82% of screen),
  //      and the upper end must stay above the bottom home-indicator
  //      region (y ≥ 15% of screen). Since we clamp flickDist at
  //      ≤35% of viewport, the finger never crosses into the Swiper
  //      zone during a flick.
  const flickDurationMs = 300;
  const cx = Math.round(width / 2);
  const flickLowY = Math.round(height * 0.82);
  const viewportCenterY = Math.round(viewportTop + (viewportBottom - viewportTop) / 2);
  // Max usable flick span — stays well above the Swiper region and
  // below the home indicator.
  const flickMax = Math.round(height * 0.35);
  // Min flick span — below this, iOS rubber-band damping eats the
  // gesture and `node.rect.y` moves by sub-pixel amounts that would
  // spuriously trip the stall detector.
  const flickMin = Math.round(height * 0.15);
  // Default push when the target isn't in the tree yet — a medium
  // distance that makes visible progress without overshooting a
  // just-about-to-appear row.
  const flickHint = Math.round(height * 0.3);

  /**
   * Execute a single flick of `flickDist` logical points in `dir`.
   * `up` means "finger moves up, content shifts up, rows below
   * viewport come into view". Finger always originates at flickLowY
   * (below the Swiper) and the other end of the drag is computed
   * from the requested distance so bigger flicks reach higher on the
   * screen but never crest the bottom-of-Swiper line.
   */
  const doFlick = async (dir: 'up' | 'down', flickDist: number): Promise<void> => {
    const span = Math.max(flickMin, Math.min(flickMax, Math.round(flickDist)));
    // The high end of the flick — always above flickLowY by `span` pts.
    const topY = Math.max(Math.round(height * 0.15), flickLowY - span);
    if (dir === 'up') {
      await flickFromTo(cx, flickLowY, cx, topY, flickDurationMs);
    } else {
      await flickFromTo(cx, topY, cx, flickLowY, flickDurationMs);
    }
  };

  /**
   * Cheap fingerprint of the current flat tree used to decide whether
   * the scroll view actually moved / changed between iterations. We
   * only need enough entropy to detect "exact same tree" vs "some
   * change"; full hashing is overkill and the `flat.length` + outer
   * identifiers are stable enough to flag a truly-stuck screen.
   */
  const fingerprint = (flat: FlatNode[]): string =>
    `${flat.length}:${flat[0]?.identifier ?? ''}:${flat[flat.length - 1]?.identifier ?? ''}`;

  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let iterations = 0;
  // Stall detection: if the node's y stops changing between flicks,
  // we've hit the end of the scroll view and further scrolling won't
  // help — bail out early with a useful message instead of timing out.
  let lastY: number | null = null;
  let stallCount = 0;
  // Null-node stall: when the target selector matches zero nodes AND
  // the tree hasn't changed for several iterations, the list simply
  // doesn't contain the element. Fail fast with a precise error
  // instead of flicking for the full 60s budget.
  let lastFingerprint: string | null = null;
  let nullStreak = 0;

  while (Date.now() < deadline) {
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    const node = predicate(flat);

    if (node && isFullyVisible(node)) {
      return node;
    }

    // Obstruction recovery: if the tree now contains a notification
    // banner, app switcher, or dev menu, we've been pushed out of the
    // app mid-scroll. Without this, scroll-until burns its 60s budget
    // flicking a scroll view it can't reach and fails with a confusing
    // "timed out" message. With it, a Signal banner arriving 20s into
    // the scroll is dismissed and the loop continues.
    //
    // Cheap check: we already have the flat tree for this iteration —
    // look for the obstruction markers before issuing another fetch.
    // If found, call preflight (which will do its own fetch + recover)
    // and restart the iteration so the next pass sees the recovered
    // tree.
    const obstructed = flat.some(
      (n) =>
        n.identifier === 'SBSwitcherWindow:Main' ||
        n.identifier === 'NotificationShortLookView' ||
        n.identifier === 'ShortLook.Platter' ||
        n.identifier === 'xmark'
    );
    if (obstructed) {
      await preflightDismissDevMenu();
      // Reset trackers — the obstructed iteration's lastY and tree
      // fingerprint are not meaningful comparisons against post-recovery.
      lastY = null;
      stallCount = 0;
      lastFingerprint = null;
      nullStreak = 0;
      continue;
    }

    // Pick the scroll direction AND distance for THIS iteration.
    let dir: 'up' | 'down' = hintDirection;
    let flickDist = flickHint;

    if (node && node.rect) {
      // Target IS in the tree. Compute the gap between its centre and
      // the viewport centre, and flick exactly that much in the sign
      // direction — clamped so a single flick can't overshoot the
      // opposite edge.
      const nodeCenterY = node.rect.y + node.rect.height / 2;
      const delta = nodeCenterY - viewportCenterY;
      dir = delta > 0 ? 'up' : 'down';
      flickDist = Math.min(flickMax, Math.abs(delta));

      // Stall detection on y — if the rect barely moved between flicks
      // we're pinned against a scroll edge. Bail out cleanly.
      if (lastY !== null && Math.abs(node.rect.y - lastY) < 8) {
        stallCount++;
        if (stallCount >= 3) {
          throw new Error(
            `scroll until ${label} visible: scrolled to the edge of the list but target is still outside the viewport (y=${Math.round(node.rect.y)}, viewport ${viewportTop}..${viewportBottom}). The element may be inside a fixed-height container or overlapped by the home indicator.`
          );
        }
      } else {
        stallCount = 0;
      }
      lastY = node.rect.y;
      // Reset the null-streak tracker — we DID find the node this iter.
      lastFingerprint = null;
      nullStreak = 0;
    } else {
      // Target NOT in the tree. Track how many iterations in a row this
      // persists WITH the tree unchanged — indicates the list simply
      // doesn't contain the selector, not that we're still scrolling
      // toward it. Fail fast after 5 such iterations (at ~8s per fetch
      // on a dense wallet home, that's ~40s, well inside the budget).
      const fp = fingerprint(flat);
      if (fp === lastFingerprint) {
        nullStreak++;
        if (nullStreak >= 5) {
          throw new Error(
            `scroll until ${label} visible: selector matched zero nodes across 5 iterations and the tree is not changing — check the testID or confirm the list actually contains this entry`
          );
        }
      } else {
        nullStreak = 0;
      }
      lastFingerprint = fp;
      // Target-less iterations use the hint direction and a medium
      // flick — enough progress to keep moving, but not so much we
      // blow past a row that's about to mount.
      dir = hintDirection;
      flickDist = flickHint;
    }

    await doFlick(dir, flickDist);
    // Tiny settle after the flick so the next tree-read sees the new
    // scroll offset. 150ms is a compromise between letting iOS's
    // post-drag animation settle and keeping iterations fast.
    await sleep(150);
    iterations++;

    // Safety valve — even without a stall, don't scroll forever.
    // 40 flicks at up to ~35% viewport each is ~14 screens of scroll,
    // comfortably more than any realistic list we target.
    if (iterations > 40) {
      break;
    }
  }

  throw new Error(
    `scroll until ${label} visible: timed out after ${Date.now() - startedAt}ms (${iterations} flicks)`
  );
}

export async function tapByText(text: string): Promise<{ node: FlatNode; nudge: boolean }> {
  // ── Fast path: session-based predicate find + rect ──
  try {
    const sid = await getCachedSession();
    const escaped = text.replace(/'/g, "\\'");
    const findRes = await wdaRequest('POST', `/session/${sid}/element`, {
      using: '-ios predicate string',
      value: `label == '${escaped}' OR name == '${escaped}'`,
    });
    const eid: string | undefined = findRes.value?.ELEMENT || findRes.value?.element;
    if (eid) {
      const rectRes = await wdaRequest('GET', `/session/${sid}/element/${eid}/rect`);
      const r = rectRes.value;
      if (r && typeof r.x === 'number') {
        const cx = Math.round(r.x + r.width / 2);
        const cy = Math.round(r.y + r.height / 2);
        await tapXY(cx, cy);
        // Can't determine nudge without the full tree — assume no nudge
        // on the fast path (the element was found by text, so it likely
        // lacks a testID, but we skip the nudge to avoid the tree fetch).
        return {
          node: {
            identifier: '',
            label: text,
            name: text,
            type: '',
            rect: r,
            centerX: cx,
            centerY: cy,
            hasIdent: false,
            hasText: true,
          },
          nudge: true,
        };
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/no such element|NoSuchElement/i.test(msg) && !msg.includes('404')) {
      invalidateCachedSession();
    }
  }

  // ── Full-tree fallback ──
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  const match = findByText(flat, text);
  if (!match) throw new Error(`no element matches text "${text}" on the current screen`);
  await tapXY(match.node.centerX, match.node.centerY);
  return { node: match.node, nudge: !match.node.hasIdent };
}

export async function tapKeypadDigit(digit: string): Promise<void> {
  if (!/^[0-9]$/.test(digit)) {
    throw new Error(`keypad arg must be a single digit 0-9, got "${digit}"`);
  }
  // Pre-flight: dismiss any dev menu, notification banner, or app
  // switcher obstruction before looking for the keypad. `execStep`'s
  // `keypad` case calls this helper directly rather than going
  // through `performTap`, so without this call the keypad path
  // bypasses the recovery logic every other tap gets. Cell 1/4 of
  // the send-token coverage matrix failed because of exactly this:
  // a notification banner arrived between `wait for #amount-next`
  // and `keypad 1`, the keypad was still on screen under the banner,
  // but `findByTestID` on the banner-containing tree couldn't see
  // the digit.
  await preflightDismissDevMenu();
  // Small settle: when called immediately after a navigation, the keypad
  // can be in the tree but not yet ready to receive taps (its underlying
  // gesture handler is still attaching). 200ms is enough to clear that
  // race in practice.
  await sleep(200);
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  // Keypad digits are sized buttons (~60x60). Filter to nodes whose label/name
  // is exactly the digit AND have a sizeable rect, to avoid hitting a static
  // text "1" elsewhere on screen.
  const candidates = flat.filter(
    (n) =>
      n.rect && (n.label === digit || n.name === digit) && n.rect.width >= 40 && n.rect.height >= 40
  );
  if (candidates.length === 0) {
    throw new Error(
      `no keypad digit "${digit}" visible. ` +
        `Either the keypad isn't on screen, or its digits aren't sized as expected (>=40px).`
    );
  }
  // Pick the largest match (the keypad button, not any incidental text).
  candidates.sort((a, b) => b.rect!.width * b.rect!.height - a.rect!.width * a.rect!.height);
  await tapXY(candidates[0].centerX, candidates[0].centerY);
  // Tiny post-tap settle so subsequent steps see the updated amount/state.
  await sleep(150);
}

/**
 * Detect whether a freshly-flattened tree is showing an obstruction
 * that will prevent the app's own testIDs from ever matching — an
 * iOS notification banner, the app switcher, or the Expo dev menu.
 *
 * Used by the wait/scroll/tap helpers to drive an in-loop call to
 * `preflightDismissDevMenu` when an obstruction is noticed mid-poll.
 * Without this, a banner sliding in during a 10s wait makes the
 * whole poll window useless — none of the app's testIDs are in the
 * Springboard-rooted tree the query returns, and the caller times
 * out on an element that was always there underneath.
 */
function treeHasObstruction(flat: FlatNode[]): boolean {
  return flat.some(
    (n) =>
      n.identifier === 'SBSwitcherWindow:Main' ||
      n.identifier === 'NotificationShortLookView' ||
      n.identifier === 'ShortLook.Platter' ||
      n.identifier === 'xmark' ||
      n.label === 'Allow Paste' ||
      n.name === 'Allow Paste'
  );
}

export async function waitForID(id: string, timeoutMs: number = STEP_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const FAST_POLL_MS = 80;
  const OBSTRUCTION_INTERVAL_MS = 2_000;
  let lastObstructionCheck = Date.now();
  let fastPathFailed = false;

  while (Date.now() < deadline) {
    const now = Date.now();

    // ── Periodic full-tree check for obstructions ──
    // Every ~2s (and on the very first iteration) we fall back to the
    // full tree fetch so we can detect dev-menu overlays, notification
    // banners, and the iOS app switcher. While we have the tree, we
    // also check for the element itself — it's free at that point.
    if (now - lastObstructionCheck >= OBSTRUCTION_INTERVAL_MS) {
      lastObstructionCheck = now;
      try {
        const tree = await getCurrentTree();
        const flat = flattenAll(tree);
        if (findByTestID(flat, id)) return;
        if (treeHasObstruction(flat)) {
          await preflightDismissDevMenu();
          invalidateCachedSession();
          continue;
        }
      } catch {
        // Tree fetch failed — try fast path anyway.
      }
    }

    // ── Fast path: session-based POST /element ──
    if (!fastPathFailed) {
      try {
        const sid = await getCachedSession();
        if (await fastFindByID(sid, id)) return;
        // Check for iOS paste permission dialog. GET /alert/text is fast
        // (~20ms, 404 when no alert). If a paste dialog is showing, find
        // the "Allow Paste" button via session element find and tap it
        // directly — don't use /alert/accept which might hit "Don't Allow".
        try {
          const alertRes = await wdaRequest('GET', `/session/${sid}/alert/text`);
          const alertText: string = alertRes.value || '';
          if (/paste/i.test(alertText)) {
            try {
              const btnRes = await wdaRequest('POST', `/session/${sid}/element`, {
                using: '-ios predicate string',
                value: `label == 'Allow Paste'`,
              });
              const btnEid: string | undefined = btnRes.value?.ELEMENT || btnRes.value?.element;
              if (btnEid) {
                const rectRes = await wdaRequest('GET', `/session/${sid}/element/${btnEid}/rect`);
                const r = rectRes.value;
                if (r && typeof r.x === 'number') {
                  await tapXY(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
                }
              }
            } catch {
              // Button find failed — do NOT fall back to /alert/accept
              // which taps the default button ("Don't Allow Paste").
            }
            await sleep(500);
            lastObstructionCheck = Date.now();
            continue;
          }
        } catch {
          // "no such alert" — continue polling.
        }
      } catch {
        // Session error — invalidate and fall back to slow path.
        invalidateCachedSession();
        fastPathFailed = true;
        continue;
      }
      await sleep(FAST_POLL_MS);
      continue;
    }

    // ── Slow fallback (only if fast path errored out) ──
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    if (findByTestID(flat, id)) return;
    if (treeHasObstruction(flat)) {
      await preflightDismissDevMenu();
      continue;
    }
    await sleep(400);
  }

  throw new Error(
    `timeout after ${timeoutMs}ms\n` +
      `Verify the testID "${id}" exists in the app:\n` +
      `  rg 'testID.*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|name=.*${id
        .replace('screen-', '')
        .split('-')
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join('')}' --type tsx --type ts`
  );
}

export async function waitForText(
  text: string,
  timeoutMs: number = STEP_TIMEOUT_MS
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const FAST_POLL_MS = 80;
  const OBSTRUCTION_INTERVAL_MS = 2_000;
  let lastObstructionCheck = Date.now();
  let fastPathFailed = false;

  while (Date.now() < deadline) {
    const now = Date.now();

    if (now - lastObstructionCheck >= OBSTRUCTION_INTERVAL_MS) {
      lastObstructionCheck = now;
      try {
        const tree = await getCurrentTree();
        const flat = flattenAll(tree);
        if (findByText(flat, text)) return;
        if (treeHasObstruction(flat)) {
          await preflightDismissDevMenu();
          invalidateCachedSession();
          continue;
        }
      } catch {
        // Tree fetch failed — try fast path anyway.
      }
    }

    if (!fastPathFailed) {
      try {
        const sid = await getCachedSession();
        if (await fastFindByText(sid, text)) return;
        // Fast paste-dialog dismissal (same as waitForID).
        try {
          const alertRes = await wdaRequest('GET', `/session/${sid}/alert/text`);
          if (/paste/i.test(alertRes.value || '')) {
            try {
              const btnRes = await wdaRequest('POST', `/session/${sid}/element`, {
                using: '-ios predicate string',
                value: `label == 'Allow Paste'`,
              });
              const btnEid: string | undefined = btnRes.value?.ELEMENT || btnRes.value?.element;
              if (btnEid) {
                const rectRes = await wdaRequest('GET', `/session/${sid}/element/${btnEid}/rect`);
                const r = rectRes.value;
                if (r && typeof r.x === 'number') {
                  await tapXY(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
                }
              }
            } catch {
              try {
                await wdaRequest('POST', `/session/${sid}/alert/accept`);
              } catch {}
            }
            await sleep(500);
            lastObstructionCheck = Date.now();
            continue;
          }
        } catch {
          // No alert — continue polling.
        }
      } catch {
        invalidateCachedSession();
        fastPathFailed = true;
        continue;
      }
      await sleep(FAST_POLL_MS);
      continue;
    }

    // Slow fallback.
    const tree = await getCurrentTree();
    const flat = flattenAll(tree);
    if (findByText(flat, text)) return;
    if (treeHasObstruction(flat)) {
      await preflightDismissDevMenu();
      continue;
    }
    await sleep(400);
  }

  throw new Error(`timeout after ${timeoutMs}ms`);
}

/**
 * Find the topmost matching node by testID prefix. Prefers in-viewport
 * matches: list-style screens often have testIDs in the AX tree for rows
 * that are scrolled off-screen, and tapping their off-screen coordinates
 * just hits whatever's at the bottom edge of the visible viewport. By
 * filtering to nodes with reasonable on-screen rects we avoid that
 * footgun. Falls back to any match if nothing in-viewport matches.
 */
export function findByTestIDPrefix(nodes: FlatNode[], prefix: string): FlatNode | null {
  const all = nodes.filter((n) => n.identifier.startsWith(prefix));
  if (all.length === 0) return null;
  // Prefer matches that are visible in a reasonable viewport (the iPhone
  // logical screen is ~390×844 on iPhone 12-15, larger on Pro Max). We
  // accept y in [0, 900] as "visible enough" — anything beyond that is
  // almost certainly off-screen in the scroll view.
  const visible = all.filter((n) => n.rect && n.rect.y >= 0 && n.rect.y < 900 && n.rect.height > 0);
  if (visible.length > 0) {
    // Return the visually topmost (lowest y) — for date-sorted lists
    // this is the newest entry.
    visible.sort((a, b) => a.rect!.y - b.rect!.y);
    return visible[0];
  }
  return all[0];
}

/**
 * Find the first node whose testID starts with `prefix` in tree
 * traversal order, skipping nodes with a zero-sized rect (which are
 * unrenderable and would never be tappable anyway).
 *
 * Contrast with `findByTestIDPrefix`, which filters to in-viewport
 * nodes and then sorts by `y` to pick the visually topmost match.
 * That heuristic is fine for a vertical list like the wallet's
 * transaction rows, where topmost-visible == newest, but it's
 * y-unstable for siblings on the same horizontal row (the amount
 * suggestion chips all sit at identical y values, so the topmost
 * sort collapses to insertion order anyway — and becomes subtly
 * broken any time the sort is unstable or a chip's rect glitches).
 *
 * `first` is the explicit version: the FIRST-mounted matching node
 * in `flattenAll`'s document order. Because `flattenAll` does a
 * pre-order traversal of the WDA `/source` tree and React/Expo
 * renders children in JSX order, that's always the same element
 * the test author would point at when they say "the first chip".
 * The `rect.width > 0 && rect.height > 0` filter drops placeholder
 * / off-screen-but-in-tree siblings that would otherwise win the
 * race for position 0.
 */
export function findByTestIDPrefixFirst(nodes: FlatNode[], prefix: string): FlatNode | null {
  for (const n of nodes) {
    if (n.identifier.startsWith(prefix) && n.rect && n.rect.width > 0 && n.rect.height > 0) {
      return n;
    }
  }
  return null;
}

export async function assertID(id: string): Promise<void> {
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  if (!findByTestID(flat, id)) {
    throw new Error(`assert-id failed: testID="${id}" not on screen`);
  }
}

export async function assertText(text: string): Promise<void> {
  const tree = await getCurrentTree();
  const flat = flattenAll(tree);
  if (!findByText(flat, text)) {
    throw new Error(`assert-text failed: "${text}" not on screen`);
  }
}

export async function detectDeviceLabel(): Promise<string> {
  try {
    const status = await wdaRequest('GET', '/status');
    const os = status.value?.os;
    return os ? `${status.value?.device || 'iphone'} (${os.name} ${os.version})` : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Single-shot health probe for WDA. 2-second timeout so it doesn't block
 * the runner if the daemon is dead but the port is bound by a stale forwarder.
 */
async function isWDAReady(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const res = await fetch('http://localhost:8100/status', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const json = (await res.json()) as { value?: { ready?: boolean } };
    return json?.value?.ready === true;
  } catch {
    return false;
  }
}

/**
 * Ensure WDA is up and answering HTTP before the test runner does anything
 * that needs it. The strategy is fail-fast: ONE bring-up attempt, single
 * 90-second budget, every `[wda]`/`[wda:runner]` line streamed live to
 * the user's terminal so they see what's happening as it happens.
 *
 * If the bring-up fails we dump the tail of `wda.log` so the actual
 * underlying error (testmanagerd dropping the connection, signing issue,
 * etc.) is visible without the user having to open the log file. Then we
 * surface the recovery steps — replug, toggle Developer Mode, restart
 * phone. Retrying inside the runner doesn't help when the device-side
 * handshake is dead; the user has to do device-level recovery first.
 *
 * Set `LOG_DOCTOR_SKIP_WDA_BRINGUP=1` to bypass this check (useful when
 * debugging WDA issues by hand or when the daemon is being managed
 * outside the runner).
 */
export async function ensureWDAReady(): Promise<void> {
  if (await isWDAReady()) return;

  if (process.env.LOG_DOCTOR_SKIP_WDA_BRINGUP === '1') {
    throw new Error(
      'WDA not reachable at http://localhost:8100 and LOG_DOCTOR_SKIP_WDA_BRINGUP=1 is set.\n' +
        'Bring it up manually with: npm run dev:wda'
    );
  }

  emitRecoveryLine('▸ WDA not reachable. Bringing it up via scripts/start-wda.sh…');

  // Best-effort cleanup of any leaked ios processes from a previous
  // failed bring-up. Otherwise the new tunnel/forwarder collides with
  // the stale one bound to port 8100.
  spawnSync('pkill', ['-9', '-f', 'ios tunnel'], { stdio: 'ignore' });
  spawnSync('pkill', ['-9', '-f', 'ios runwda'], { stdio: 'ignore' });
  spawnSync('pkill', ['-9', '-f', 'ios forward'], { stdio: 'ignore' });
  spawnSync('pkill', ['-9', '-f', 'start-wda'], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1000));

  // Spawn start-wda.sh detached so WDA stays alive after the runner
  // exits — subsequent test runs reuse it and skip this whole path.
  // Output goes to wda.log (append); we tail it for live progress.
  const logFd = fs.openSync(nodePath.resolve(process.cwd(), 'wda.log'), 'a');
  const child = spawn('bash', ['scripts/start-wda.sh'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: process.cwd(),
  });
  child.unref();
  const startedAt = Date.now();
  let logCursor = fs.fstatSync(logFd).size;
  fs.closeSync(logFd);

  // 180-second budget: 120s WDA-HTTP wait inside the script + ~30s of
  // tunnel/forwarder setup + ~30s slack for forwarder restarts. If it's
  // not up by then it's not coming up without device recovery.
  const BUDGET_MS = 180_000;
  let failureLineSeen = false;
  while (Date.now() - startedAt < BUDGET_MS) {
    if (await isWDAReady()) {
      emitRecoveryLine('▸ WDA READY ✓');
      return;
    }
    try {
      const stat = fs.statSync('wda.log');
      if (stat.size > logCursor) {
        const fd = fs.openSync('wda.log', 'r');
        const buf = Buffer.alloc(stat.size - logCursor);
        fs.readSync(fd, buf, 0, buf.length, logCursor);
        fs.closeSync(fd);
        logCursor = stat.size;
        const chunk = buf.toString('utf-8');
        // Surface every wda log line live — no filtering. Users want to
        // see what's happening, especially when it's not happening.
        for (const line of chunk.split('\n')) {
          if (
            line.startsWith('[wda]') ||
            line.startsWith('[wda:runner]') ||
            line.startsWith('[wda:tunnel]')
          ) {
            emitRecoveryLine(`  ${line}`);
          }
        }
        if (chunk.includes('did not become ready')) {
          failureLineSeen = true;
          break;
        }
      }
    } catch {
      /* wda.log may not exist yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Build the error message — include the tail of wda.log so the user
  // sees the actual underlying cause (e.g. "lost connection to
  // testmanagerd") without having to open the log file.
  let logTail = '';
  try {
    const all = fs.readFileSync('wda.log', 'utf-8').split('\n');
    logTail = all.slice(-30).join('\n');
  } catch {
    /* ignore */
  }

  throw new Error(
    `WDA bring-up ${failureLineSeen ? 'failed' : 'timed out'} after ${Math.floor((Date.now() - startedAt) / 1000)}s.\n` +
      '\n' +
      '──── tail of wda.log ────\n' +
      logTail +
      '\n──── recovery steps ────\n' +
      '\n' +
      "If you see 'lost connection to testmanagerd' or 'conn1 closed unexpectedly'\n" +
      'above, the device side has rejected the test runner. Try in order:\n' +
      '\n' +
      '  1. Replug the iPhone via USB\n' +
      '  2. Settings → Privacy & Security → Developer Mode → toggle off,\n' +
      '     restart phone, on, re-trust the Mac when prompted\n' +
      '  3. Restart the iPhone if (1) and (2) don’t help\n' +
      '  4. Reinstall WebDriverAgent — see docs/device-automation.md\n' +
      '\n' +
      'Set LOG_DOCTOR_SKIP_WDA_BRINGUP=1 to bypass this check while debugging.\n' +
      '\n' +
      'After recovery, re-run: npm run log-doctor -- phone test all'
  );
}
