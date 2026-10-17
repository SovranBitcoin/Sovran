/**
 * @jest-environment node
 *
 * The picker sheet's lifecycle, without rendering it: one sheet at a time,
 * each opener answered exactly once, and `closed` only once the route has
 * gone.
 */

import {
  answerPicker,
  openPicker,
  pickerRouteMounted,
  pickerRouteUnmounted,
} from '@/shared/lib/picker/openPicker';
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

beforeEach(() => {
  // Ends whatever an earlier test left open.
  pickerRouteUnmounted();
  mockPush.mockClear();
});

describe('openPicker', () => {
  it('pushes the route once and hands the rows over', () => {
    openPicker(request('Select profile'));
    expect(mockPush).toHaveBeenCalledWith('/picker');
    expect(usePickerSheetStore.getState().request?.title).toBe('Select profile');
  });

  it('answers a tap at once, and closes only when the route unmounts', async () => {
    const session = openPicker(request('One'));
    pickerRouteMounted();

    expect(answerPicker({ kind: 'option', id: 'a' })).toBe(true);
    await expect(session.result).resolves.toEqual({ kind: 'option', id: 'a' });
    expect(await settled(session.closed)).toBe(false);

    pickerRouteUnmounted();
    expect(await settled(session.closed)).toBe(true);
    expect(usePickerSheetStore.getState().request).toBeNull();
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
    expect(usePickerSheetStore.getState().request?.title).toBe('Second');

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
    expect(usePickerSheetStore.getState().request?.title).toBe('First');

    pickerRouteUnmounted();
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(usePickerSheetStore.getState().request?.title).toBe('Next');
    expect(await settled(next.result)).toBe(false);
  });

  it('lets only the current opener change the rows', () => {
    const first = openPicker(request('First'));
    pickerRouteMounted();
    const second = openPicker(request('Second'));

    first.update(request('First again'));
    expect(usePickerSheetStore.getState().request?.title).toBe('Second');

    second.update(request('Second, refreshed'));
    expect(usePickerSheetStore.getState().request?.title).toBe('Second, refreshed');

    answerPicker({ kind: 'option', id: 'a' });
    second.update(request('After the answer'));
    expect(usePickerSheetStore.getState().request?.title).toBe('Second, refreshed');
  });

  it('ignores a tap on a sheet nobody opened', () => {
    pickerRouteMounted();
    expect(answerPicker({ kind: 'option', id: 'a' })).toBe(false);
  });
});
