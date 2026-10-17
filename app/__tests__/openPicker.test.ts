/**
 * @jest-environment node
 *
 * The picker sheet's lifecycle, without rendering it: one sheet at a time,
 * each opener answered exactly once, and `closed` only once the route has
 * gone.
 */

import { pickOption, pickerSheet } from '@/shared/lib/picker/openPicker';
import { createSheetRoute, OPEN_BOUND_MS, type SheetRoute } from '@/shared/lib/picker/sheetRoute';
import type { PickerRequest } from '@/shared/lib/picker/types';
import { usePickerSheetStore } from '@/shared/stores/runtime/pickerSheetStore';

const mockPush = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { raw: { push: (...args: unknown[]) => mockPush(...args) } },
}));

const request = (title: string): PickerRequest => ({
  title,
  options: [{ id: 'a', title: 'A', testID: 'row-a' }],
});

/** Whether a promise has settled, after letting pending callbacks run. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  void promise.then(() => (done = true));
  await Promise.resolve();
  await Promise.resolve();
  return done;
}

/** A fresh lifecycle per test, handing its requests to `shown`. */
let sheet: SheetRoute<PickerRequest>;
let shown: PickerRequest | null = null;
const openPicker = (next: PickerRequest) => sheet.open(next);

/** The screen's side of the lifecycle, for the open sheet's current instance. */
let instance: number | null = null;
const answerPicker = (...args: Parameters<SheetRoute<PickerRequest>['answer']>) =>
  sheet.answer(...args);
const pickerRouteMounted = () => {
  instance = sheet.mounted();
};
const pickerRouteUnmounted = () => sheet.unmounted(instance);

beforeEach(() => {
  sheet = createSheetRoute<PickerRequest>('/picker', {
    show: (next) => (shown = next),
    clear: () => (shown = null),
  });
  shown = null;
  instance = null;
  mockPush.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a sheet route', () => {
  it('pushes the route once and hands the request over', () => {
    openPicker(request('Select profile'));
    expect(mockPush).toHaveBeenCalledWith('/picker');
    expect(shown?.title).toBe('Select profile');
  });

  it('answers a tap at once, and closes only when the route unmounts', async () => {
    const session = openPicker(request('One'));
    pickerRouteMounted();

    expect(answerPicker({ kind: 'option', id: 'a' })).toBe(true);
    await expect(session.result).resolves.toEqual({ kind: 'option', id: 'a' });
    expect(await settled(session.closed)).toBe(false);

    pickerRouteUnmounted();
    expect(await settled(session.closed)).toBe(true);
    expect(shown).toBeNull();
  });

  it('counts only the first tap', async () => {
    const session = openPicker(request('One'));
    pickerRouteMounted();
    expect(answerPicker({ kind: 'action', id: 'create' })).toBe(true);
    expect(answerPicker({ kind: 'option', id: 'a' })).toBe(false);
    await expect(session.result).resolves.toEqual({ kind: 'action', id: 'create' });
  });

  it('answers dismissed when the sheet goes without a tap', async () => {
    const session = openPicker(request('One'));
    pickerRouteMounted();
    pickerRouteUnmounted();
    await expect(session.result).resolves.toEqual({ kind: 'dismissed' });
    expect(await settled(session.closed)).toBe(true);
  });

  it('replaces an open picker in the same sheet, dismissing the earlier opener', async () => {
    const first = openPicker(request('First'));
    pickerRouteMounted();
    const second = openPicker(request('Second'));

    await expect(first.result).resolves.toEqual({ kind: 'dismissed' });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(shown?.title).toBe('Second');

    // The first opener's sheet is still on screen, now showing the second.
    expect(await settled(first.closed)).toBe(false);
    answerPicker({ kind: 'option', id: 'a' });
    await expect(second.result).resolves.toEqual({ kind: 'option', id: 'a' });
    pickerRouteUnmounted();
    expect(await settled(first.closed)).toBe(true);
    expect(await settled(second.closed)).toBe(true);
  });

  it('waits for a closing sheet to go before opening the next', async () => {
    openPicker(request('First'));
    pickerRouteMounted();
    answerPicker({ kind: 'option', id: 'a' });

    const next = openPicker(request('Next'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(shown?.title).toBe('First');

    pickerRouteUnmounted();
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(shown?.title).toBe('Next');
    expect(await settled(next.result)).toBe(false);
  });

  it('lets only the current opener change the rows', () => {
    const first = openPicker(request('First'));
    pickerRouteMounted();
    const second = openPicker(request('Second'));

    first.update(request('First again'));
    expect(shown?.title).toBe('Second');

    second.update(request('Second, refreshed'));
    expect(shown?.title).toBe('Second, refreshed');

    answerPicker({ kind: 'option', id: 'a' });
    second.update(request('After the answer'));
    expect(shown?.title).toBe('Second, refreshed');
  });

  it('ignores a tap on a sheet nobody opened, and tells that screen to leave', () => {
    expect(sheet.mounted()).toBeNull();
    expect(answerPicker({ kind: 'option', id: 'a' })).toBe(false);
  });

  it('gives up a push that never mounts, so the next open pushes again', async () => {
    jest.useFakeTimers();
    const lost = openPicker(request('Lost'));
    jest.advanceTimersByTime(OPEN_BOUND_MS - 1);
    expect(await settled(lost.result)).toBe(false);

    jest.advanceTimersByTime(1);
    await expect(lost.result).resolves.toEqual({ kind: 'dismissed' });
    expect(await settled(lost.closed)).toBe(true);
    expect(shown).toBeNull();

    openPicker(request('Next'));
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('keeps a sheet that mounted in time open past the bound', async () => {
    jest.useFakeTimers();
    const session = openPicker(request('One'));
    pickerRouteMounted();
    jest.advanceTimersByTime(OPEN_BOUND_MS * 2);
    expect(await settled(session.result)).toBe(false);
  });

  it('ignores the unmount of a screen from a push that was given up', async () => {
    jest.useFakeTimers();
    openPicker(request('Lost'));
    jest.advanceTimersByTime(OPEN_BOUND_MS);
    // The lost push lands late: nobody is waiting, so it leaves.
    const late = sheet.mounted();
    expect(late).toBeNull();

    const next = openPicker(request('Next'));
    pickerRouteMounted();
    sheet.unmounted(late);
    expect(await settled(next.result)).toBe(false);
  });
});

describe('pickOption', () => {
  it('resolves with the row, or null without one', async () => {
    let mounted: number | null;
    const picked = pickOption(request('One'));
    mounted = pickerSheet.mounted();
    pickerSheet.answer({ kind: 'option', id: 'a' });
    await expect(picked).resolves.toBe('a');
    pickerSheet.unmounted(mounted);

    const dismissed = pickOption(request('Two'));
    mounted = pickerSheet.mounted();
    pickerSheet.unmounted(mounted);
    await expect(dismissed).resolves.toBeNull();
  });

  it('shows the rows in the picker sheet store', () => {
    void pickOption(request('Shown'));
    expect(usePickerSheetStore.getState().request?.title).toBe('Shown');
    expect(mockPush).toHaveBeenCalledWith('/picker');
  });
});
