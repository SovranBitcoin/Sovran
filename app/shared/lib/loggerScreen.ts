// ═══════════════════════════════════════════════════════════════════════════════
// SCREEN PERFORMANCE — per-page mount, navigation and render instrumentation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Mounted once, inside `Screen`, so every page that renders one is covered
// without instrumenting pages one by one. Keyed by the Screen's `name`:
//
//   nav.transition  route change dispatched → this Screen's first commit
//   screen.mount    first render → first commit (`shell_ms`) and → the commit
//                   that shows the deferred content (`content_ms`)
//   render.why      which Screen input changed on each later commit, with the
//                   running render count (`useWhyDidRender`)
//
// Kept off the public logger barrel on purpose: this file imports expo-router,
// which the barrel's non-UI consumers must not load.

import { useEffect, useRef, useState } from 'react';
import { useNavigationContainerRef } from 'expo-router';

import { log, monotonicNow, SHOW_LOGS } from './loggerCore';
import { useWhyDidRender } from './loggerRender';

interface RouteChangeSource {
  addListener(
    type: '__unsafe_action__',
    listener: (event: { data: { action: { type: string }; noop: boolean } }) => void
  ): unknown;
}

/**
 * Actions that mount no new page. A back or pop reveals a page that is already
 * mounted, so there is no first commit to time; letting one arm the timer would
 * credit it to whichever unrelated Screen mounted next.
 */
const NO_DESTINATION_ACTIONS: ReadonlySet<string> = new Set([
  'GO_BACK',
  'POP',
  'POP_TO_TOP',
  'SET_PARAMS',
  'REPLACE_PARAMS',
  'PRELOAD',
  'OPEN_DRAWER',
  'CLOSE_DRAWER',
  'TOGGLE_DRAWER',
]);

/** A route change nothing claimed within this long mounted no Screen at all. */
const ROUTE_CHANGE_TTL_MS = 10_000;

let observing = false;
let pendingRouteChange: { at: number; action: string } | null = null;

/**
 * Record the moment each navigation action is dispatched. `__unsafe_action__`
 * fires at dispatch, before the destination renders — the container's `state`
 * event would be too late, since it fires after the destination's own effects.
 */
function observeRouteChanges(source: RouteChangeSource | null | undefined): void {
  if (observing || typeof source?.addListener !== 'function') return;
  observing = true;
  source.addListener('__unsafe_action__', (event) => {
    const { action, noop } = event.data;
    if (noop || NO_DESTINATION_ACTIONS.has(action.type)) return;
    pendingRouteChange = { at: monotonicNow(), action: action.type };
  });
}

/** The first Screen to commit after a route change is its destination. */
function claimRouteChange(now: number): { at: number; action: string } | null {
  const change = pendingRouteChange;
  pendingRouteChange = null;
  return change && now - change.at <= ROUTE_CHANGE_TTL_MS ? change : null;
}

const roundMs = (ms: number) => Math.round(ms * 100) / 100;

// Tests routinely mock `expo-router` down to the exports they use. Resolved
// once, so a mock without this hook still renders Screen — it just has no
// route changes to time.
const useRouteChangeSource: () => RouteChangeSource | null =
  typeof useNavigationContainerRef === 'function' ? useNavigationContainerRef : () => null;

function useScreenPerfLive(
  name: string,
  contentReady: boolean,
  inputs: () => Record<string, unknown>
): void {
  const routeChanges = useRouteChangeSource();
  const [startedAt] = useState(monotonicNow);
  const shellMs = useRef<number | null>(null);
  const contentLogged = useRef(false);

  useEffect(() => {
    // First commit only; `name` is in the deps for correctness, not to re-fire.
    if (shellMs.current !== null) return;
    const now = monotonicNow();
    shellMs.current = roundMs(now - startedAt);
    observeRouteChanges(routeChanges);
    const change = claimRouteChange(now);
    if (change) {
      log.debug('nav.transition', {
        screen: name,
        action: change.action,
        duration_ms: roundMs(now - change.at),
      });
    }
  }, [name, routeChanges, startedAt]);

  useEffect(() => {
    if (!contentReady || contentLogged.current) return;
    contentLogged.current = true;
    log.debug('screen.mount', {
      screen: name,
      shell_ms: shellMs.current,
      content_ms: roundMs(monotonicNow() - startedAt),
    });
  }, [contentReady, name, startedAt]);

  // Its own key: several pages already call `useWhyDidRender` under their
  // screen name, and sharing it would merge two different sets of inputs.
  useWhyDidRender(`Screen(${name})`, inputs);
}

/**
 * Per-page performance instrumentation for `Screen`. Pass the Screen's `name`,
 * whether its deferred content has mounted, and a thunk of the values that feed
 * its render.
 *
 * Like the render hooks, this does work on every commit, so a release build
 * gets a no-op chosen once at module init from the build-time `SHOW_LOGS`.
 */
export const useScreenPerf: (
  name: string,
  contentReady: boolean,
  inputs: () => Record<string, unknown>
) => void = SHOW_LOGS ? useScreenPerfLive : () => {};
