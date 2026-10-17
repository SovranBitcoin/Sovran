/**
 * @fileoverview Opening the picker sheet and hearing back from it.
 *
 * The sheet is the `picker` route (`app/picker.tsx`). This module owns its
 * lifecycle: which opener the sheet is answering, when that opener's answer
 * resolves, and when the sheet has gone. The route only reports that it
 * mounted, that a row or button was tapped, and that it unmounted.
 *
 * One sheet at a time. Opening a picker while one is up answers the earlier
 * opener `dismissed` and shows the new rows in the same sheet. Opening one
 * while a sheet is closing waits for it to go, then pushes a fresh one.
 */

import { guardedRouter as router } from '@/shared/hooks/useGuardedRouter';
import { usePickerSheetStore } from '@/shared/stores/runtime/pickerSheetStore';

import type { PickerRequest, PickerResult, PickerSession } from './types';

interface OpenPicker {
  request: PickerRequest;
  answered: boolean;
  answer: (result: PickerResult) => void;
  gone: () => void;
}

const DISMISSED: PickerResult = { kind: 'dismissed' };

/**
 * Where the route is. `opening`: pushed, not yet mounted. `leaving`: a tap
 * answered and the route is going back. A pull-down or the back button goes
 * straight from `open` to unmounted.
 */
let route: 'none' | 'opening' | 'open' | 'leaving' = 'none';
/** The opener the sheet is answering, or about to. */
let current: OpenPicker | null = null;
/** Every opener the mounted route has shown; each one's `closed` resolves when it goes. */
let shownByRoute: OpenPicker[] = [];
/** Opened while the sheet was leaving; shown once it has gone. */
let waiting: OpenPicker | null = null;

function show(picker: OpenPicker) {
  current = picker;
  shownByRoute.push(picker);
  usePickerSheetStore.getState().show(picker.request);
  if (route === 'none') {
    route = 'opening';
    // Not the guarded push: this module already keeps a second sheet from
    // stacking, and a picker reopened just after one closed must still open.
    router.raw.push('/picker');
  }
}

function answer(picker: OpenPicker, result: PickerResult) {
  if (picker.answered) return;
  picker.answered = true;
  picker.answer(result);
}

/** Show `request` in the picker sheet. */
export function openPicker(request: PickerRequest): PickerSession {
  let resolveResult!: (result: PickerResult) => void;
  let resolveClosed!: () => void;
  const result = new Promise<PickerResult>((resolve) => (resolveResult = resolve));
  const closed = new Promise<void>((resolve) => (resolveClosed = resolve));
  const picker: OpenPicker = {
    request,
    answered: false,
    answer: resolveResult,
    gone: resolveClosed,
  };

  if (route === 'leaving') {
    if (waiting) {
      answer(waiting, DISMISSED);
      waiting.gone();
    }
    waiting = picker;
  } else {
    if (current) answer(current, DISMISSED);
    show(picker);
  }

  return {
    result,
    closed,
    update: (next) => {
      if (picker.answered) return;
      picker.request = next;
      if (picker === current) usePickerSheetStore.getState().show(next);
    },
  };
}

/**
 * The route answers with a tap. Returns whether the tap counted, so the route
 * leaves only once: a second tap while it goes, or a tap on a sheet nobody
 * opened, does nothing.
 */
export function answerPicker(result: PickerResult): boolean {
  if (!current || current.answered || route === 'leaving') return false;
  answer(current, result);
  route = 'leaving';
  return true;
}

export function pickerRouteMounted(): void {
  route = 'open';
}

/** The sheet has gone, by whatever road. Anyone still waiting is told it was dismissed. */
export function pickerRouteUnmounted(): void {
  if (current) answer(current, DISMISSED);
  for (const picker of shownByRoute) picker.gone();
  shownByRoute = [];
  current = null;
  route = 'none';
  usePickerSheetStore.getState().clear();

  const next = waiting;
  waiting = null;
  if (next) show(next);
}
