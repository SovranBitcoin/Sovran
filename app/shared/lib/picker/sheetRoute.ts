/**
 * @fileoverview A route opened like a popup: pushed with what it should show,
 * answered with what was tapped.
 *
 * The picker sheet (`openPicker`) and the emoji sheet are routes, so they
 * present as real sheets over whatever screen asked. This owns their
 * lifecycle: which opener a sheet is answering, when that opener's answer
 * resolves, and when the sheet has gone. The screen only reports that it
 * mounted, that something was tapped, and that it unmounted.
 *
 * One sheet per route at a time. Opening while one is up answers the earlier
 * opener `dismissed` and shows the new request in the same sheet. Opening
 * while a sheet is closing waits for it to go, then pushes a fresh one. A push
 * the navigator drops, so that the route never mounts, is given up after
 * `OPEN_BOUND_MS`, so it cannot wedge every later open.
 */

import type { Href } from 'expo-router';

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';

import type { PickerResult, PickerSession } from './types';

/** How long a pushed sheet may take to mount before the open is given up. */
export const OPEN_BOUND_MS = 2000;

const DISMISSED: PickerResult = { kind: 'dismissed' };

interface Opener<Request> {
  request: Request;
  answered: boolean;
  answer: (result: PickerResult) => void;
  gone: () => void;
}

export interface SheetRoute<Request> {
  open: (request: Request) => PickerSession<Request>;
  /**
   * The screen answers with a tap. Returns whether it counted, so the screen
   * leaves only once: a second tap while it goes, or a tap on a sheet nobody
   * opened, does nothing.
   */
  answer: (result: PickerResult) => boolean;
  /** The screen mounted. Its instance id, or `null` when nobody opened it and it should leave. */
  mounted: () => number | null;
  /** The screen with this instance id has gone, by whatever road. */
  unmounted: (instance: number | null) => void;
}

export function createSheetRoute<Request>(
  path: Href,
  hand: { show: (request: Request) => void; clear: () => void }
): SheetRoute<Request> {
  /**
   * Where the route is. `opening`: pushed, not yet mounted. `leaving`: a tap
   * answered and the route is going back. A pull-down or the back button goes
   * straight from `open` to unmounted.
   */
  let route: 'none' | 'opening' | 'open' | 'leaving' = 'none';
  /** Which push the route state describes; a screen from an earlier one is ignored. */
  let instance = 0;
  let openingTimer: ReturnType<typeof setTimeout> | null = null;
  /** The opener the sheet is answering, or about to. */
  let current: Opener<Request> | null = null;
  /** Every opener the mounted screen has shown; each one's `closed` resolves when it goes. */
  let shown: Opener<Request>[] = [];
  /** Opened while the sheet was leaving; shown once it has gone. */
  let waiting: Opener<Request> | null = null;

  const settle = (opener: Opener<Request>, result: PickerResult) => {
    if (opener.answered) return;
    opener.answered = true;
    opener.answer(result);
  };

  const show = (opener: Opener<Request>) => {
    current = opener;
    shown.push(opener);
    hand.show(opener.request);
    if (route !== 'none') return;
    route = 'opening';
    instance += 1;
    const pushed = instance;
    openingTimer = setTimeout(() => {
      if (route === 'opening' && instance === pushed) end();
    }, OPEN_BOUND_MS);
    // Not the guarded push: this module already keeps a second sheet from
    // stacking, and a sheet reopened just after one closed must still open.
    router.raw.push(path);
  };

  const end = () => {
    if (openingTimer) clearTimeout(openingTimer);
    openingTimer = null;
    if (current) settle(current, DISMISSED);
    for (const opener of shown) opener.gone();
    shown = [];
    current = null;
    route = 'none';
    hand.clear();

    const next = waiting;
    waiting = null;
    if (next) show(next);
  };

  return {
    open: (request) => {
      let resolveResult!: (result: PickerResult) => void;
      let resolveClosed!: () => void;
      const result = new Promise<PickerResult>((resolve) => (resolveResult = resolve));
      const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
      const opener: Opener<Request> = {
        request,
        answered: false,
        answer: resolveResult,
        gone: resolveClosed,
      };

      if (route === 'leaving') {
        if (waiting) {
          settle(waiting, DISMISSED);
          waiting.gone();
        }
        waiting = opener;
      } else {
        if (current) settle(current, DISMISSED);
        show(opener);
      }

      return {
        result,
        closed,
        update: (next) => {
          if (opener.answered) return;
          opener.request = next;
          if (opener === current) hand.show(next);
        },
      };
    },
    answer: (result) => {
      if (!current || current.answered || route !== 'open') return false;
      settle(current, result);
      route = 'leaving';
      return true;
    },
    mounted: () => {
      if (route !== 'opening') return null;
      if (openingTimer) clearTimeout(openingTimer);
      openingTimer = null;
      route = 'open';
      return instance;
    },
    unmounted: (mountedInstance) => {
      if (mountedInstance === null || mountedInstance !== instance || route === 'none') return;
      end();
    },
  };
}
